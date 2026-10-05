//! V10 · ffmpeg nativo en escritorio. Ver `docs/seguridad-ffmpeg.md`.
//! v0.9.0 no incluye ningún FFmpeg: el build fijado está bloqueado en el manifiesto
//! (licencias mixtas) y todo esto responde «no disponible», como en web/Android.
//!
//! SUPERFICIE DE ATAQUE (resumen; el detalle está en cada submódulo):
//! - Binarios: solo `ffmpeg`/`ffprobe` de rutas fijas (`locate.rs`), verificados
//!   (SHA-256 del manifiesto, nunca uno bloqueado, y `-L`/`-buildconf` sin
//!   `--enable-gpl`/`--enable-nonfree`) antes del primer uso. No se usa el plugin `shell` ni el PATH.
//! - Entradas: la interfaz no envía rutas. Los archivos se registran desde el
//!   diálogo nativo abierto en Rust o desde el evento nativo de soltar, se
//!   validan (`validate.rs`) y la interfaz recibe un TOKEN opaco. Los comandos
//!   que trabajan con un archivo reciben ese token, nunca una ruta.
//! - Argumentos: se construyen en `args.rs` a partir de enums/números acotados
//!   (serde con `deny_unknown_fields`); nada de texto libre llega a argv.
//! - Salidas: solo en `<caché>/native-media/{tmp,out}` con nombres generados
//!   (`job-<n>.<ext>`, `<sha256>.<ext>`); la lectura se hace por clave de 64 hex.
//!   La exportación por hardware guarda donde el usuario diga en el diálogo
//!   nativo «Guardar» abierto desde Rust.
//! - Recursos: tiempo límite y detección de bloqueo, `-fs` y topes de bytes,
//!   lectura con tope de líneas, límite de trabajos simultáneos, cancelación
//!   que mata el proceso y borra el temporal, limpieza al salir y al arrancar.

pub mod args;
pub mod cache;
pub mod install;
pub mod locate;
pub mod probe;
pub mod process;
pub mod progress;
pub mod validate;
#[cfg(test)]
mod real_tests;

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use args::{FrameOptions, HwEncoder, HwExportOptions, ProxyOptions, ProxyPlan, VideoChoice, VideoEncoder};
use cache::Dirs;
use locate::{Located, NativeStatus};
use probe::ProbeInfo;

const MAX_SOURCES: usize = 256;
const MAX_JOBS: usize = 2;
const MAX_FRAME_READERS: usize = 4;
const MAX_READ: u64 = 16 * 1024 * 1024;
const MAX_FRAME_CHUNK: usize = 64 * 1024 * 1024;
const MAX_SOURCE_DURATION: f64 = 12.0 * 3600.0;
const STALL: Duration = Duration::from_secs(90);
const DROP_TTL: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct Source {
    path: PathBuf,
    size: u64,
}

struct Job {
    child: Mutex<Child>,
    cancelled: AtomicBool,
    last: Mutex<Instant>,
}

struct FrameReader {
    child: Mutex<Child>,
    rx: Mutex<Receiver<Vec<u8>>>,
    frame_bytes: usize,
    last_read: Mutex<Instant>,
}

struct HwJob {
    job: Arc<Job>,
    stdin: Mutex<Option<ChildStdin>>,
    frame_bytes: usize,
    video_tmp: PathBuf,
    wav_tmp: PathBuf,
    wav_bytes: Mutex<u64>,
    progress: Mutex<Option<std::thread::JoinHandle<()>>>,
}

#[derive(Default)]
struct Inner {
    detected: Option<Result<(Located, NativeStatus), NativeStatus>>,
    sources: Vec<(String, Source)>,
    dropped: Vec<(Instant, PathBuf)>,
    jobs: HashMap<u64, Arc<Job>>,
    readers: HashMap<u64, Arc<FrameReader>>,
    hw: HashMap<u64, Arc<HwJob>>,
    hw_tested: Option<Vec<HwEncoder>>,
    next: u64,
}

#[derive(Default)]
pub struct NativeMedia {
    inner: Mutex<Inner>,
    /// resultado de «verificar y omitir / reparar» la copia propia (una vez por sesión)
    install: Mutex<Option<install::Report>>,
}

impl NativeMedia {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Prepara la copia propia de FFmpeg (ver `install.rs`). Barato si ya coincide.
    /// Se llama al arrancar (en segundo plano) y antes de la primera detección;
    /// el mutex hace que dos llamadas a la vez no copien dos veces.
    pub fn resolve_install<R: Runtime>(&self, app: &AppHandle<R>, force: bool) -> install::Report {
        let mut g = self.install.lock().unwrap_or_else(|e| e.into_inner());
        if !force {
            if let Some(r) = g.as_ref() {
                return r.clone();
            }
        }
        let r = match (user_dir(app), dirs(app)) {
            (Some(dest), Ok(d)) => {
                let res = app.path().resource_dir().ok().map(|r| r.join("ffmpeg"));
                let cwd = d.tmp.clone();
                let check = move |dir: &Path| -> Result<(), String> {
                    locate::license_check(&dir.join(format!("ffmpeg{}", locate::EXE)), &dir.join(format!("ffprobe{}", locate::EXE)), &cwd).map(|_| ())
                };
                install::resolve(install::Spec::from_manifest().as_ref(), res.as_deref(), &dest, &check)
            }
            _ => install::Report { action: install::Action::Failed, detail: Some("no hay carpeta de datos de la app".into()) },
        };
        *g = Some(r.clone());
        r
    }

    /// Ruta del evento nativo de soltar (la da el sistema operativo, no la interfaz).
    pub fn note_dropped(&self, paths: &[PathBuf]) {
        let mut g = self.lock();
        let now = Instant::now();
        g.dropped.retain(|(t, _)| now.duration_since(*t) < DROP_TTL);
        for p in paths.iter().take(64) {
            g.dropped.push((now, p.clone()));
        }
        let n = g.dropped.len();
        if n > 64 {
            g.dropped.drain(0..n - 64);
        }
    }

    /// Mata todo lo que esté en marcha (al cerrar la app).
    pub fn shutdown<R: Runtime>(&self, app: &AppHandle<R>) {
        let g = self.lock();
        for j in g.jobs.values() {
            j.cancelled.store(true, Ordering::SeqCst);
            process::kill(&mut j.child.lock().unwrap_or_else(|e| e.into_inner()));
        }
        for r in g.readers.values() {
            process::kill(&mut r.child.lock().unwrap_or_else(|e| e.into_inner()));
        }
        for h in g.hw.values() {
            process::kill(&mut h.job.child.lock().unwrap_or_else(|e| e.into_inner()));
        }
        drop(g);
        if let Ok(d) = dirs(app) {
            d.clean_tmp();
        }
    }

    /// Cancela: marca y mata el proceso (el temporal lo borra `run_job`).
    pub fn cancel(&self, job_id: u64) -> bool {
        let g = self.lock();
        if let Some(j) = g.jobs.get(&job_id) {
            j.cancelled.store(true, Ordering::SeqCst);
            let _ = j.child.lock().map(|mut c| c.kill());
            return true;
        }
        if let Some(h) = g.hw.get(&job_id) {
            h.job.cancelled.store(true, Ordering::SeqCst);
            let _ = h.job.child.lock().map(|mut c| c.kill());
            return true;
        }
        false
    }

    fn next_id(g: &mut Inner) -> u64 {
        g.next += 1;
        g.next
    }

    fn register(&self, src: Source) -> String {
        use std::hash::{BuildHasher, Hasher};
        let mut g = self.lock();
        let n = Self::next_id(&mut g);
        let mut tok = String::new();
        for salt in [n, n ^ 0x9e37_79b9_7f4a_7c15] {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(salt);
            tok.push_str(&format!("{:016x}", h.finish()));
        }
        g.sources.push((tok.clone(), src));
        let len = g.sources.len();
        if len > MAX_SOURCES {
            g.sources.drain(0..len - MAX_SOURCES);
        }
        tok
    }

    fn source(&self, token: &str) -> Result<Source, String> {
        let g = self.lock();
        let s = g.sources.iter().find(|(t, _)| t == token).map(|(_, s)| s.clone());
        let s = s.ok_or_else(|| "archivo no registrado: vuelve a elegirlo".to_string())?;
        // el archivo pudo cambiar o desaparecer desde que se eligió
        let canon = validate::validate_source(&s.path).map_err(|e| e.to_string())?;
        if canon != s.path {
            return Err("el archivo cambió de ubicación: vuelve a elegirlo".into());
        }
        Ok(s)
    }
}

fn dirs<R: Runtime>(app: &AppHandle<R>) -> Result<Dirs, String> {
    let c = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Dirs::new(&c).map_err(|e| format!("no se pudo crear la caché: {e}"))
}

fn user_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("ffmpeg"))
}

/// Detecta (una vez por sesión, salvo `force`) y devuelve el binario verificado.
fn ensure<R: Runtime>(app: &AppHandle<R>, force: bool) -> Result<(Located, NativeStatus), NativeStatus> {
    let st = app.state::<NativeMedia>();
    if !force {
        if let Some(d) = &st.lock().detected {
            return d.clone();
        }
    }
    // copia propia: omitir si coincide, reparar desde los recursos si no
    // (fuera del candado principal: una copia de 150 MB no bloquea otros comandos)
    let report = st.resolve_install(app, force);
    let mut g = st.lock();
    if !force {
        if let Some(d) = &g.detected {
            return d.clone();
        }
    }
    let ud = user_dir(app);
    let uds = ud.as_ref().map(|p| p.to_string_lossy().into_owned());
    let res = (|| {
        let d = dirs(app).map_err(|e| NativeStatus::unavailable(e, uds.clone()))?;
        let loc = locate::locate(&locate::candidates(app.path().resource_dir().ok(), ud.clone()))
            .map_err(|e| NativeStatus::unavailable(e, uds.clone()))?;
        let status = locate::detect(&loc, &d.tmp, uds.clone());
        if status.available {
            Ok((loc, status))
        } else {
            Err(status)
        }
    })();
    let res = match res {
        Ok((l, mut s)) => {
            s.install = Some(report);
            Ok((l, s))
        }
        Err(mut s) => {
            s.install = Some(report);
            Err(s)
        }
    };
    g.detected = Some(res.clone());
    if force {
        g.hw_tested = None;
    }
    res
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ tipos IPC

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    token: Option<String>,
    name: String,
    size: u64,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum JobEvent {
    Started { job_id: u64, duration: f64 },
    Progress { job_id: u64, out_time_us: Option<i64>, fields: BTreeMap<String, String>, end: bool },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputRef {
    key: String,
    mime: &'static str,
    bytes: u64,
    cached: bool,
    encoder: Option<VideoEncoder>,
    probe: Option<ProbeInfo>,
}

fn register_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) -> Vec<SourceRef> {
    let st = app.state::<NativeMedia>();
    paths
        .into_iter()
        .take(32)
        .map(|p| {
            let name: String = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default().chars().take(200).collect();
            match validate::validate_source(&p) {
                Ok(canon) => {
                    let size = std::fs::metadata(&canon).map(|m| m.len()).unwrap_or(0);
                    let token = st.register(Source { path: canon, size });
                    SourceRef { token: Some(token), name, size, error: None }
                }
                Err(e) => SourceRef { token: None, name, size: 0, error: Some(e.to_string()) },
            }
        })
        .collect()
}

// ------------------------------------------------------------------ comandos

#[tauri::command]
pub async fn native_media_status<R: Runtime>(app: AppHandle<R>, refresh: Option<bool>) -> Result<NativeStatus, String> {
    blocking(move || match ensure(&app, refresh.unwrap_or(false)) {
        Ok((_, s)) => s,
        Err(s) => s,
    })
    .await
}

/// Abre el diálogo nativo «Abrir» (desde Rust) y registra lo elegido.
#[tauri::command]
pub async fn native_media_pick<R: Runtime>(app: AppHandle<R>) -> Result<Vec<SourceRef>, String> {
    blocking(move || {
        let files = app
            .dialog()
            .file()
            .set_title("Elige el video que quieres convertir para editar")
            .add_filter("Video", validate::VIDEO_EXTENSIONS)
            .blocking_pick_files();
        let paths: Vec<PathBuf> = files.unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).collect();
        register_paths(&app, paths)
    })
    .await
}

/// Registra los archivos del último evento nativo de soltar (≤ 2 min).
#[tauri::command]
pub async fn native_media_take_dropped<R: Runtime>(app: AppHandle<R>) -> Result<Vec<SourceRef>, String> {
    blocking(move || {
        let paths: Vec<PathBuf> = {
            let st = app.state::<NativeMedia>();
            let mut g = st.lock();
            let now = Instant::now();
            g.dropped.drain(..).filter(|(t, _)| now.duration_since(*t) < DROP_TTL).map(|(_, p)| p).collect()
        };
        register_paths(&app, paths)
    })
    .await
}

fn run_probe(loc: &Located, d: &Dirs, src: &Source) -> Result<ProbeInfo, String> {
    let cmd = process::command(&loc.ffprobe, &args::probe_args(&src.path), &d.tmp);
    let out = process::run_capture(cmd, Duration::from_secs(30), 4 << 20, 64 << 10).map_err(|e| format!("no se pudo ejecutar ffprobe: {e}"))?;
    if out.timed_out {
        return Err("ffprobe tardó demasiado (archivo dañado o muy raro)".into());
    }
    if out.overflow {
        return Err("respuesta de ffprobe demasiado grande".into());
    }
    if !out.ok {
        return Err(format!("FFmpeg no puede leer el archivo: {}", process::tail_message(&out.stderr)));
    }
    probe::parse_probe(&String::from_utf8_lossy(&out.stdout), src.size)
}

#[tauri::command]
pub async fn native_media_probe<R: Runtime>(app: AppHandle<R>, token: String) -> Result<ProbeInfo, String> {
    blocking(move || {
        let (loc, _) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        let src = app.state::<NativeMedia>().source(&token)?;
        let d = dirs(&app)?;
        run_probe(&loc, &d, &src)
    })
    .await?
}

fn hw_tested<R: Runtime>(app: &AppHandle<R>, loc: &Located, status: &NativeStatus) -> Vec<HwEncoder> {
    if let Some(v) = &app.state::<NativeMedia>().lock().hw_tested {
        return v.clone();
    }
    let tmp = dirs(app).map(|d| d.tmp).unwrap_or_else(|_| std::env::temp_dir());
    let ok: Vec<HwEncoder> = status
        .listed_hw_encoders
        .iter()
        .copied()
        .filter(|e| {
            let cmd = process::command(&loc.ffmpeg, &args::hw_test_args(*e), &tmp);
            matches!(process::run_capture(cmd, Duration::from_secs(20), 64 << 10, 64 << 10), Ok(c) if c.ok)
        })
        .collect();
    app.state::<NativeMedia>().lock().hw_tested = Some(ok.clone());
    ok
}

/// Encoders H.264 por hardware/sistema que funcionan de verdad en esta máquina.
#[tauri::command]
pub async fn native_media_hw_encoders<R: Runtime>(app: AppHandle<R>) -> Result<Vec<HwEncoder>, String> {
    blocking(move || {
        let (loc, status) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        Ok(hw_tested(&app, &loc, &status))
    })
    .await?
}

fn resolve_plan<R: Runtime>(app: &AppHandle<R>, loc: &Located, status: &NativeStatus, p: &ProbeInfo, o: &ProxyOptions) -> Result<ProxyPlan, String> {
    let v = p.video.as_ref().ok_or("el archivo no tiene video")?;
    let platform_h264 = || -> Option<VideoEncoder> {
        let ok = hw_tested(app, loc, status);
        if cfg!(windows) && ok.contains(&HwEncoder::H264Mf) {
            Some(VideoEncoder::H264Mf)
        } else if cfg!(target_os = "macos") && ok.contains(&HwEncoder::H264Videotoolbox) {
            Some(VideoEncoder::H264VideoToolbox)
        } else {
            None
        }
    };
    let encoder = match o.video {
        VideoChoice::H264 => platform_h264().ok_or("no hay codificador H.264 del sistema en este equipo")?,
        VideoChoice::Vp8 => {
            if !status.has_libvpx {
                return Err("este FFmpeg no trae VP8 (libvpx)".into());
            }
            VideoEncoder::Libvpx
        }
        VideoChoice::Auto => match platform_h264() {
            Some(e) => e,
            None if status.has_libvpx => VideoEncoder::Libvpx,
            None => return Err("este FFmpeg no tiene ningún codificador de proxy compatible".into()),
        },
    };
    Ok(ProxyPlan {
        encoder,
        height: o.height.px(),
        kbps: o.height.video_kbps(),
        fps: args::snap_fps(v.fps),
        hdr: if o.tonemap && status.has_zscale { p.hdr_input } else { None },
        has_audio: p.audio.is_some(),
    })
}

/// Ejecuta un trabajo con progreso, vigilancia y limpieza; mueve `tmp` → `out` al terminar bien.
fn run_job(
    st: &NativeMedia,
    ffmpeg: &Path,
    argv: Vec<std::ffi::OsString>,
    cwd: &Path,
    tmp: PathBuf,
    out: &Path,
    duration: f64,
    max_bytes: u64,
    emit: &dyn Fn(JobEvent),
) -> Result<u64, String> {
    let mut cmd = process::command(ffmpeg, &argv, cwd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("no se pudo iniciar FFmpeg: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let job = Arc::new(Job { child: Mutex::new(child), cancelled: AtomicBool::new(false), last: Mutex::new(Instant::now()) });
    let id = {
        let mut g = st.lock();
        let id = NativeMedia::next_id(&mut g);
        g.jobs.insert(id, job.clone());
        id
    };
    emit(JobEvent::Started { job_id: id, duration });
    // stderr: solo los últimos 64 KiB
    let err_h = std::thread::spawn(move || {
        let mut r = stderr;
        let mut keep: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            keep.extend_from_slice(&buf[..n]);
            if keep.len() > 64 << 10 {
                let cut = keep.len() - (64 << 10);
                keep.drain(..cut);
            }
        }
        keep
    });
    // vigilante: cancelación, bloqueo, tiempo total y tamaño del temporal
    let total_limit = Duration::from_secs_f64((duration * 20.0).clamp(120.0, 12.0 * 3600.0));
    let wj = job.clone();
    let wtmp = tmp.clone();
    let done = Arc::new(AtomicBool::new(false));
    let wdone = done.clone();
    let watch = std::thread::spawn(move || {
        let start = Instant::now();
        while !wdone.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(250));
            let stalled = wj.last.lock().map(|t| t.elapsed() > STALL).unwrap_or(false);
            let too_big = std::fs::metadata(&wtmp).map(|m| m.len() > max_bytes).unwrap_or(false);
            if wj.cancelled.load(Ordering::SeqCst) || stalled || start.elapsed() > total_limit || too_big {
                if !wj.cancelled.swap(true, Ordering::SeqCst) {
                    eprintln!("[native-media] trabajo detenido (bloqueo, tiempo o tamaño)");
                }
                let _ = wj.child.lock().map(|mut c| c.kill());
            }
        }
    });
    let mut reader = BufReader::new(stdout);
    let mut parser = progress::ProgressParser::default();
    let mut buf = Vec::new();
    while let Ok(Some(line)) = progress::read_line_capped(&mut reader, &mut buf) {
        if let Some(b) = parser.push_line(&line) {
            if let Ok(mut t) = job.last.lock() {
                *t = Instant::now();
            }
            emit(JobEvent::Progress { job_id: id, out_time_us: progress::out_time_us(&b), fields: b.fields, end: b.end });
        }
    }
    let status = loop {
        let r = job.child.lock().map(|mut c| c.try_wait());
        match r {
            Ok(Ok(Some(s))) => break Some(s),
            Ok(Ok(None)) => std::thread::sleep(Duration::from_millis(20)),
            _ => break None,
        }
    };
    done.store(true, Ordering::SeqCst);
    let _ = watch.join();
    let err = err_h.join().unwrap_or_default();
    st.lock().jobs.remove(&id);
    let cancelled = job.cancelled.load(Ordering::SeqCst);
    let ok = status.map(|s| s.success()).unwrap_or(false) && !cancelled;
    let len = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
    if !ok || len == 0 || len > max_bytes {
        let _ = std::fs::remove_file(&tmp);
        return Err(if cancelled {
            "cancelado".into()
        } else {
            format!("FFmpeg falló: {}", process::tail_message(&err))
        });
    }
    std::fs::rename(&tmp, out).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("no se pudo guardar el resultado: {e}")
    })?;
    Ok(len)
}

#[tauri::command]
pub async fn native_media_proxy<R: Runtime>(app: AppHandle<R>, token: String, options: ProxyOptions, on_event: Channel<JobEvent>) -> Result<OutputRef, String> {
    blocking(move || {
        let (loc, status) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        let src = app.state::<NativeMedia>().source(&token)?;
        let d = dirs(&app)?;
        let p = run_probe(&loc, &d, &src)?;
        if p.duration > MAX_SOURCE_DURATION {
            return Err("el video dura más de 12 horas".into());
        }
        let plan = resolve_plan(&app, &loc, &status, &p, &options)?;
        let profile = format!("{:?}/{}/{}/{}-{}/{:?}/{}", plan.encoder, plan.height, plan.kbps, plan.fps.0, plan.fps.1, plan.hdr, plan.has_audio);
        let key = cache::key_for(&src.path, &profile, status.version.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
        let ext = plan.encoder.container().ext();
        let out = d.out.join(format!("{key}.{ext}"));
        if let Ok(m) = std::fs::metadata(&out) {
            if m.is_file() && m.len() > 0 {
                if let Ok(f) = std::fs::File::options().write(true).open(&out) {
                    let _ = f.set_modified(std::time::SystemTime::now()); // LRU
                }
                return Ok(OutputRef { key, mime: plan.encoder.container().mime(), bytes: m.len(), cached: true, encoder: Some(plan.encoder), probe: Some(p) });
            }
        }
        if app.state::<NativeMedia>().lock().jobs.len() >= MAX_JOBS {
            return Err("ya hay dos conversiones en marcha: espera a que terminen".into());
        }
        let n = { let st = app.state::<NativeMedia>(); let mut g = st.lock(); NativeMedia::next_id(&mut g) };
        let tmp = d.tmp.join(format!("job-{n}.{ext}"));
        let argv = args::proxy_args(&src.path, &tmp, &plan);
        let bytes = run_job(&app.state::<NativeMedia>(), &loc.ffmpeg, argv, &d.tmp, tmp, &out, p.duration, args::MAX_PROXY_BYTES, &|e| {
            let _ = on_event.send(e);
        })?;
        cache::evict(&d.out, cache::MAX_CACHE_BYTES, &out);
        Ok(OutputRef { key, mime: plan.encoder.container().mime(), bytes, cached: false, encoder: Some(plan.encoder), probe: Some(p) })
    })
    .await?
}

#[tauri::command]
pub async fn native_media_extract_audio<R: Runtime>(app: AppHandle<R>, token: String, on_event: Channel<JobEvent>) -> Result<OutputRef, String> {
    blocking(move || {
        let (loc, status) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        let src = app.state::<NativeMedia>().source(&token)?;
        let d = dirs(&app)?;
        let p = run_probe(&loc, &d, &src)?;
        if p.audio.is_none() {
            return Err("el archivo no tiene audio".into());
        }
        if p.duration > MAX_SOURCE_DURATION {
            return Err("el archivo dura más de 12 horas".into());
        }
        let key = cache::key_for(&src.path, "wav/pcm_s16le/48000/2", status.version.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
        let out = d.out.join(format!("{key}.wav"));
        if let Ok(m) = std::fs::metadata(&out) {
            if m.is_file() && m.len() > 44 {
                return Ok(OutputRef { key, mime: "audio/wav", bytes: m.len(), cached: true, encoder: None, probe: Some(p) });
            }
        }
        if app.state::<NativeMedia>().lock().jobs.len() >= MAX_JOBS {
            return Err("ya hay dos conversiones en marcha: espera a que terminen".into());
        }
        let n = { let st = app.state::<NativeMedia>(); let mut g = st.lock(); NativeMedia::next_id(&mut g) };
        let tmp = d.tmp.join(format!("job-{n}.wav"));
        let argv = args::extract_audio_args(&src.path, &tmp);
        let bytes = run_job(&app.state::<NativeMedia>(), &loc.ffmpeg, argv, &d.tmp, tmp, &out, p.duration, args::MAX_WAV_BYTES, &|e| {
            let _ = on_event.send(e);
        })?;
        cache::evict(&d.out, cache::MAX_CACHE_BYTES, &out);
        Ok(OutputRef { key, mime: "audio/wav", bytes, cached: false, encoder: None, probe: Some(p) })
    })
    .await?
}

#[tauri::command]
pub fn native_media_cancel<R: Runtime>(app: AppHandle<R>, job_id: u64) -> bool {
    app.state::<NativeMedia>().cancel(job_id)
}

/// Lee un trozo (≤ 16 MiB) de un resultado de la caché por su clave.
#[tauri::command]
pub async fn native_media_read<R: Runtime>(app: AppHandle<R>, key: String, offset: u64, length: u64) -> Result<Response, String> {
    blocking(move || {
        if !validate::is_cache_key(&key) {
            return Err("clave no válida".to_string());
        }
        let d = dirs(&app)?;
        let path = ["mp4", "webm", "wav"].iter().map(|e| d.out.join(format!("{key}.{e}"))).find(|p| p.is_file()).ok_or("resultado no encontrado")?;
        let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        let off = offset.min(size);
        let n = length.min(MAX_READ).min(size - off) as usize;
        f.seek(SeekFrom::Start(off)).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; n];
        f.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok(Response::new(buf))
    })
    .await?
}

#[tauri::command]
pub async fn native_media_cache_clear<R: Runtime>(app: AppHandle<R>) -> Result<u64, String> {
    blocking(move || {
        let d = dirs(&app)?;
        if !app.state::<NativeMedia>().lock().jobs.is_empty() {
            return Err("hay conversiones en marcha".to_string());
        }
        Ok(cache::evict(&d.out, 0, Path::new("")))
    })
    .await?
}

// ------------------------------------- fotogramas crudos (exportar del original)

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameJob {
    job_id: u64,
    frame_bytes: usize,
}

#[tauri::command]
pub async fn native_media_frames_open<R: Runtime>(app: AppHandle<R>, token: String, options: FrameOptions) -> Result<FrameJob, String> {
    blocking(move || {
        options.validate().map_err(String::from)?;
        let (loc, _) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        let src = app.state::<NativeMedia>().source(&token)?;
        let d = dirs(&app)?;
        reap_idle_readers(&app);
        if app.state::<NativeMedia>().lock().readers.len() >= MAX_FRAME_READERS {
            return Err("demasiados lectores de fotogramas abiertos".into());
        }
        let fb = options.frame_bytes();
        let mut cmd = process::command(&loc.ffmpeg, &args::frames_args(&src.path, &options), &d.tmp);
        cmd.stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("no se pudo iniciar FFmpeg: {e}"))?;
        let mut stdout = child.stdout.take().unwrap();
        // cola acotada por BYTES (≈ 64 MiB): si nadie lee, ffmpeg se bloquea en el tubo
        let cap = (MAX_FRAME_CHUNK / fb).max(1);
        let (tx, rx) = sync_channel::<Vec<u8>>(cap);
        std::thread::spawn(move || loop {
            let mut frame = vec![0u8; fb];
            if stdout.read_exact(&mut frame).is_err() || tx.send(frame).is_err() {
                break;
            }
        });
        let st = app.state::<NativeMedia>();
        let mut g = st.lock();
        let id = NativeMedia::next_id(&mut g);
        g.readers.insert(id, Arc::new(FrameReader { child: Mutex::new(child), rx: Mutex::new(rx), frame_bytes: fb, last_read: Mutex::new(Instant::now()) }));
        Ok(FrameJob { job_id: id, frame_bytes: fb })
    })
    .await?
}

fn reap_idle_readers<R: Runtime>(app: &AppHandle<R>) {
    let st = app.state::<NativeMedia>();
    let mut g = st.lock();
    g.readers.retain(|_, r| {
        let idle = r.last_read.lock().map(|t| t.elapsed() > Duration::from_secs(300)).unwrap_or(true);
        if idle {
            let _ = r.child.lock().map(|mut c| process::kill(&mut c));
        }
        !idle
    });
}

/// Hasta `max_frames` fotogramas RGBA seguidos (≤ 64 MiB). Vacío = fin.
#[tauri::command]
pub async fn native_media_frames_read<R: Runtime>(app: AppHandle<R>, job_id: u64, max_frames: u32) -> Result<Response, String> {
    blocking(move || {
        let r = app.state::<NativeMedia>().lock().readers.get(&job_id).cloned().ok_or("lector cerrado")?;
        if let Ok(mut t) = r.last_read.lock() {
            *t = Instant::now();
        }
        let max = (max_frames.max(1) as usize).min((MAX_FRAME_CHUNK / r.frame_bytes).max(1));
        let rx = r.rx.lock().map_err(|_| "lector roto")?;
        let mut out = Vec::new();
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(f) => out.extend_from_slice(&f),
            Err(RecvTimeoutError::Disconnected) => return Ok(Response::new(Vec::new())),
            Err(RecvTimeoutError::Timeout) => return Err("FFmpeg no entrega fotogramas (bloqueado)".into()),
        }
        while out.len() / r.frame_bytes < max {
            match rx.try_recv() {
                Ok(f) => out.extend_from_slice(&f),
                Err(_) => break,
            }
        }
        Ok(Response::new(out))
    })
    .await?
}

#[tauri::command]
pub fn native_media_frames_close<R: Runtime>(app: AppHandle<R>, job_id: u64) -> bool {
    let r = app.state::<NativeMedia>().lock().readers.remove(&job_id);
    if let Some(r) = r {
        let _ = r.child.lock().map(|mut c| process::kill(&mut c));
        return true;
    }
    false
}

// ---------------------------------- exportación por hardware (EXPERIMENTAL)

#[tauri::command]
pub async fn native_media_hw_export_open<R: Runtime>(app: AppHandle<R>, options: HwExportOptions, on_event: Channel<JobEvent>) -> Result<u64, String> {
    blocking(move || {
        options.validate().map_err(String::from)?;
        let (loc, status) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        if !hw_tested(&app, &loc, &status).contains(&options.encoder) {
            return Err("ese codificador no funciona en este equipo".into());
        }
        let d = dirs(&app)?;
        let st = app.state::<NativeMedia>();
        if !st.lock().hw.is_empty() {
            return Err("ya hay una exportación por hardware en marcha".into());
        }
        let n = { let mut g = st.lock(); NativeMedia::next_id(&mut g) };
        let video_tmp = d.tmp.join(format!("hw-{n}.mp4"));
        let wav_tmp = d.tmp.join(format!("hw-{n}.wav"));
        let mut cmd = process::command(&loc.ffmpeg, &args::hw_export_args(&options, &video_tmp), &d.tmp);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("no se pudo iniciar FFmpeg: {e}"))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let job = Arc::new(Job { child: Mutex::new(child), cancelled: AtomicBool::new(false), last: Mutex::new(Instant::now()) });
        let id = { let mut g = st.lock(); NativeMedia::next_id(&mut g) };
        let chan = on_event.clone();
        let progress = std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut parser = progress::ProgressParser::default();
            let mut buf = Vec::new();
            while let Ok(Some(line)) = progress::read_line_capped(&mut reader, &mut buf) {
                if let Some(b) = parser.push_line(&line) {
                    let _ = chan.send(JobEvent::Progress { job_id: id, out_time_us: progress::out_time_us(&b), fields: b.fields, end: b.end });
                }
            }
        });
        let _ = on_event.send(JobEvent::Started { job_id: id, duration: 0.0 });
        st.lock().hw.insert(
            id,
            Arc::new(HwJob { job, stdin: Mutex::new(stdin), frame_bytes: options.width as usize * options.height as usize * 4, video_tmp, wav_tmp, wav_bytes: Mutex::new(0), progress: Mutex::new(Some(progress)) }),
        );
        Ok(id)
    })
    .await?
}

fn hw_from_request<R: Runtime>(app: &AppHandle<R>, req: &Request<'_>) -> Result<(Arc<HwJob>, Vec<u8>), String> {
    let id: u64 = req.headers().get("x-job").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).ok_or("falta x-job")?;
    let InvokeBody::Raw(bytes) = req.body() else {
        return Err("se esperaban bytes".into());
    };
    if bytes.len() > MAX_FRAME_CHUNK {
        return Err("trozo demasiado grande".into());
    }
    let h = app.state::<NativeMedia>().lock().hw.get(&id).cloned().ok_or("exportación cerrada")?;
    Ok((h, bytes.clone()))
}

/// Fotogramas RGBA (múltiplo exacto del tamaño de fotograma) hacia el codificador.
#[tauri::command]
pub async fn native_media_hw_export_write<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let (h, bytes) = hw_from_request(&app, &request)?;
    blocking(move || {
        if bytes.is_empty() || bytes.len() % h.frame_bytes != 0 {
            return Err("tamaño de fotograma incorrecto".to_string());
        }
        let mut g = h.stdin.lock().map_err(|_| "roto")?;
        let w = g.as_mut().ok_or("entrada cerrada")?;
        w.write_all(&bytes).map_err(|_| "el codificador se detuvo".to_string())
    })
    .await?
}

/// Audio WAV (en trozos, el primero con cabecera RIFF/WAVE) para unir al final.
#[tauri::command]
pub async fn native_media_hw_export_write_audio<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<(), String> {
    let (h, bytes) = hw_from_request(&app, &request)?;
    blocking(move || {
        let mut n = h.wav_bytes.lock().map_err(|_| "roto")?;
        if *n == 0 && !(bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE") {
            return Err("el audio debe empezar con una cabecera WAV".to_string());
        }
        if *n + bytes.len() as u64 > args::MAX_WAV_BYTES {
            return Err("audio demasiado grande".to_string());
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&h.wav_tmp).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
        *n += bytes.len() as u64;
        Ok(())
    })
    .await?
}

fn safe_file_name(s: &str) -> String {
    let mut n: String = s
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(100)
        .collect::<String>()
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if n.is_empty() {
        n = "video".into();
    }
    if !n.to_ascii_lowercase().ends_with(".mp4") {
        n.push_str(".mp4");
    }
    n
}

/// Cierra la entrada, espera, une el audio (si hay) y pide dónde guardar (diálogo nativo).
#[tauri::command]
pub async fn native_media_hw_export_finish<R: Runtime>(app: AppHandle<R>, job_id: u64, file_name: String) -> Result<Option<String>, String> {
    blocking(move || {
        let st = app.state::<NativeMedia>();
        let h = st.lock().hw.get(&job_id).cloned().ok_or("exportación cerrada")?;
        let cleanup = |h: &HwJob| {
            let _ = std::fs::remove_file(&h.video_tmp);
            let _ = std::fs::remove_file(&h.wav_tmp);
            app.state::<NativeMedia>().lock().hw.remove(&job_id);
        };
        drop(h.stdin.lock().ok().and_then(|mut s| s.take())); // EOF para ffmpeg
        let start = Instant::now();
        let ok = loop {
            match h.job.child.lock().map(|mut c| c.try_wait()) {
                Ok(Ok(Some(s))) => break s.success(),
                Ok(Ok(None)) if start.elapsed() < Duration::from_secs(600) => std::thread::sleep(Duration::from_millis(50)),
                _ => {
                    let _ = h.job.child.lock().map(|mut c| process::kill(&mut c));
                    break false;
                }
            }
        };
        if let Some(t) = h.progress.lock().ok().and_then(|mut p| p.take()) {
            let _ = t.join();
        }
        if !ok || h.job.cancelled.load(Ordering::SeqCst) {
            cleanup(&h);
            return Err("la exportación por hardware falló o se canceló".into());
        }
        let (loc, _) = ensure(&app, false).map_err(|s| s.reason.unwrap_or_default())?;
        let d = dirs(&app)?;
        let final_tmp = if h.wav_tmp.is_file() {
            let muxed = h.video_tmp.with_extension("mux.mp4");
            let cmd = process::command(&loc.ffmpeg, &args::mux_audio_args(&h.video_tmp, &h.wav_tmp, &muxed), &d.tmp);
            let r = process::run_capture(cmd, Duration::from_secs(1800), 1 << 20, 64 << 10);
            if !matches!(r, Ok(ref c) if c.ok) {
                let _ = std::fs::remove_file(&muxed);
                cleanup(&h);
                return Err("no se pudo unir el audio".into());
            }
            muxed
        } else {
            h.video_tmp.clone()
        };
        let dest = app.dialog().file().set_title("Guardar video").set_file_name(safe_file_name(&file_name)).add_filter("MP4", &["mp4"]).blocking_save_file();
        let res = match dest.and_then(|f| f.into_path().ok()) {
            None => Ok(None),
            Some(p) => {
                let moved = std::fs::rename(&final_tmp, &p).or_else(|_| std::fs::copy(&final_tmp, &p).map(|_| ()));
                moved.map(|_| Some(p.to_string_lossy().into_owned())).map_err(|e| format!("no se pudo guardar: {e}"))
            }
        };
        let _ = std::fs::remove_file(&final_tmp);
        cleanup(&h);
        res
    })
    .await?
}

#[tauri::command]
pub fn native_media_hw_export_abort<R: Runtime>(app: AppHandle<R>, job_id: u64) -> bool {
    let h = app.state::<NativeMedia>().lock().hw.remove(&job_id);
    if let Some(h) = h {
        h.job.cancelled.store(true, Ordering::SeqCst);
        drop(h.stdin.lock().ok().and_then(|mut s| s.take()));
        let _ = h.job.child.lock().map(|mut c| process::kill(&mut c));
        let _ = std::fs::remove_file(&h.video_tmp);
        let _ = std::fs::remove_file(&h.wav_tmp);
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_for_save_dialog() {
        assert_eq!(safe_file_name("../../x"), "x.mp4");
        assert_eq!(safe_file_name(r"C:\Windows\evil.exe"), "CWindowsevil.exe.mp4");
        assert_eq!(safe_file_name("mi video.mp4"), "mi video.mp4");
        assert_eq!(safe_file_name(""), "video.mp4");
        assert_eq!(safe_file_name("a\nb\0c"), "abc.mp4");
        assert!(safe_file_name(&"x".repeat(500)).len() <= 104);
    }

    #[test]
    fn dropped_paths_expire_and_are_capped() {
        let nm = NativeMedia::default();
        let many: Vec<PathBuf> = (0..200).map(|i| PathBuf::from(format!("/x/{i}.mp4"))).collect();
        nm.note_dropped(&many);
        assert_eq!(nm.lock().dropped.len(), 64);
    }

    #[test]
    fn tokens_are_unique_and_unknown_tokens_fail() {
        let nm = NativeMedia::default();
        let a = nm.register(Source { path: PathBuf::from("/a.mp4"), size: 1 });
        let b = nm.register(Source { path: PathBuf::from("/a.mp4"), size: 1 });
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(nm.source("no-existe").is_err());
        assert!(nm.source("../../etc/passwd").is_err());
        // registrado pero ya no existe en disco → error (se revalida en cada uso)
        assert!(nm.source(&a).is_err());
    }
}
