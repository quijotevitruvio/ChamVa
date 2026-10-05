//! Pruebas con el FFmpeg REAL de `src-tauri/binaries/ffmpeg/` (lo coloca
//! `node scripts/fetch-ffmpeg.mjs`). Si no está, se omiten con un aviso: así
//! `cargo test` sigue pasando en máquinas y CI sin el binario.
//!
//! Estas pruebas ejercitan el código nativo (argumentos, procesos, progreso) con
//! un binario LOCAL que no se distribuye. No pasan por `locate`: la app rechaza el
//! build BtbN fijado (bloqueado por licencias en el manifiesto de v0.9.0), y eso
//! lo comprueban `locate::tests::real_blocked_dev_binary_is_not_used` y compañía.

use super::args::{self, ProxyPlan, VideoEncoder};
use super::locate::{self, Check, Origin, EXE};
use super::process::{command, run_capture};
use super::progress;
use super::validate::validate_source;
use super::{probe, run_job, JobEvent, NativeMedia};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn dev_dir() -> Option<PathBuf> {
    let d = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg");
    if d.join(format!("ffmpeg{EXE}")).is_file() {
        Some(d)
    } else {
        eprintln!("(sin FFmpeg en {}: se omite la prueba real)", d.display());
        None
    }
}

/// Binario de desarrollo tal cual, sin `locate` (solo pruebas locales).
fn dev_located(dir: &Path) -> locate::Located {
    locate::Located { ffmpeg: dir.join(format!("ffmpeg{EXE}")), ffprobe: dir.join(format!("ffprobe{EXE}")), origin: Origin::Dev }
}

fn work(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("chamva-real-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    std::fs::canonicalize(&d).unwrap()
}

/// Genera un clip sintético (lavfi) con argumentos fijos de la prueba.
fn gen(ff: &Path, cwd: &Path, out: &Path, extra: &[&str]) {
    let mut a: Vec<std::ffi::OsString> = ["-hide_banner", "-loglevel", "error", "-y"].iter().map(Into::into).collect();
    a.extend(extra.iter().map(Into::into));
    a.push(out.as_os_str().to_owned());
    let r = run_capture(command(ff, &a, cwd), Duration::from_secs(120), 1 << 20, 1 << 20).unwrap();
    assert!(r.ok, "no se pudo generar {}: {}", out.display(), String::from_utf8_lossy(&r.stderr));
}

fn probe_ok(ffprobe: &Path, cwd: &Path, src: &Path) -> Result<probe::ProbeInfo, String> {
    let r = run_capture(command(ffprobe, &args::probe_args(src), cwd), Duration::from_secs(30), 4 << 20, 64 << 10).unwrap();
    if !r.ok {
        return Err(String::from_utf8_lossy(&r.stderr).into_owned());
    }
    probe::parse_probe(&String::from_utf8_lossy(&r.stdout), 0)
}

fn plan() -> ProxyPlan {
    ProxyPlan { encoder: VideoEncoder::Libvpx, height: 360, kbps: 1200, fps: (30, 1), hdr: None, has_audio: true }
}

#[test]
fn real_detection_reads_declared_license() {
    let Some(dir) = dev_dir() else { return };
    let loc = dev_located(&dir);
    let st = locate::detect(&loc, &work("detect"), None);
    assert!(st.available, "{:?}", st.reason);
    // lo que DECLARA `-L` (el build BtbN dice LGPL aunque sus bibliotecas no lo sean: ver auditoría)
    assert_eq!(st.license.as_deref(), Some("LGPL-3.0-or-later"));
    assert!(st.has_libvpx && st.has_zscale);
    #[cfg(windows)]
    assert!(st.listed_hw_encoders.contains(&args::HwEncoder::H264Mf));
}

#[test]
fn real_hostile_names_probe_and_convert() {
    let Some(dir) = dev_dir() else { return };
    let loc = dev_located(&dir);
    let w = work("hostile");
    let base = w.join("base.mp4");
    gen(&loc.ffmpeg, &w, &base, &["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000", "-t", "2", "-c:v", "libkvazaar", "-tag:v", "hvc1", "-c:a", "aac", "-shortest"]);
    let names = ["-i evil.mp4", "a;b & c.mp4", "$(calc) `x`.mov", "con 'comillas' y espacios.mkv", "concat:x.mp4", "-y.mp4", "pipe:1.mp4"];
    for n in names {
        let p = w.join(n);
        std::fs::copy(&base, &p).unwrap();
        let canon = validate_source(&p).unwrap();
        let info = probe_ok(&loc.ffprobe, &w, &canon).unwrap_or_else(|e| panic!("{n}: {e}"));
        assert_eq!(info.video.as_ref().unwrap().codec, "hevc", "{n}");
    }
    // conversión real con progreso
    let canon = validate_source(&w.join("-i evil.mp4")).unwrap();
    let nm = NativeMedia::default();
    let tmp = w.join("job-1.webm");
    let out = w.join("salida.webm");
    let events = std::sync::Mutex::new(Vec::new());
    let r = run_job(&nm, &loc.ffmpeg, args::proxy_args(&canon, &tmp, &plan()), &w, tmp.clone(), &out, 2.0, args::MAX_PROXY_BYTES, &|e| events.lock().unwrap().push(e));
    assert!(r.is_ok(), "{r:?}");
    assert!(out.is_file() && !tmp.exists());
    let ev = events.into_inner().unwrap();
    assert!(matches!(ev.first(), Some(JobEvent::Started { .. })));
    let last = ev.iter().rev().find_map(|e| match e {
        JobEvent::Progress { out_time_us, end, .. } => Some((*out_time_us, *end)),
        _ => None,
    });
    let (t, end) = last.unwrap();
    assert!(end);
    assert!(t.unwrap() >= 1_900_000, "{t:?}");
    // el resultado se puede volver a leer: VP8 + Opus en WebM
    let info = probe_ok(&loc.ffprobe, &w, &validate_source(&out).unwrap()).unwrap();
    assert_eq!(info.video.unwrap().codec, "vp8");
    assert_eq!(info.audio.unwrap().codec, "opus");
    let _ = std::fs::remove_dir_all(&w);
}

#[test]
fn real_whitelists_block_playlists_and_scripts() {
    let Some(dir) = dev_dir() else { return };
    let loc = dev_located(&dir);
    let w = work("trap");
    let victim = w.join("secreto.webm");
    gen(&loc.ffmpeg, &w, &victim, &["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10", "-t", "1", "-c:v", "libvpx"]);
    let v = victim.to_string_lossy().replace("\\\\?\\", "");
    let traps = [
        ("hls.mp4", format!("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:{v}\n#EXTINF:1,\nhttp://127.0.0.1:9/x.ts\n#EXT-X-ENDLIST\n")),
        ("concat.mp4", format!("ffconcat version 1.0\nfile '{v}'\n")),
        ("sdp.mp4", "v=0\no=- 0 0 IN IP4 127.0.0.1\ns=x\nc=IN IP4 127.0.0.1\nt=0 0\nm=video 9 RTP/AVP 96\na=rtpmap:96 H264/90000\n".to_string()),
        ("texto.mp4", "esto no es un video\n".repeat(50)),
    ];
    for (n, body) in traps {
        let p = w.join(n);
        std::fs::write(&p, body).unwrap();
        let canon = validate_source(&p).unwrap();
        let r = probe_ok(&loc.ffprobe, &w, &canon);
        assert!(r.is_err(), "{n} debería rechazarse y se abrió: {r:?}");
    }
    let _ = std::fs::remove_dir_all(&w);
}

#[test]
fn real_cancel_kills_process_and_cleans_tmp() {
    let Some(dir) = dev_dir() else { return };
    let loc = dev_located(&dir);
    let w = work("cancel");
    let src = w.join("largo.mkv");
    // 60 s de 1080p en MPEG-2 (rápido de generar, lento de pasar a VP8)
    gen(&loc.ffmpeg, &w, &src, &["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "60", "-c:v", "mpeg2video", "-q:v", "8"]);
    let canon = validate_source(&src).unwrap();
    let nm = std::sync::Arc::new(NativeMedia::default());
    let tmp = w.join("job-7.webm");
    let out = w.join("no-debe-existir.webm");
    let (tx, rx) = mpsc::channel::<JobEvent>();
    let nm2 = nm.clone();
    let (ff, tmp2, out2, w2) = (loc.ffmpeg.clone(), tmp.clone(), out.clone(), w.clone());
    let mut p = plan();
    p.has_audio = false;
    p.height = 1080;
    let h = std::thread::spawn(move || {
        let tx = std::sync::Mutex::new(tx);
        run_job(&nm2, &ff, args::proxy_args(&canon, &tmp2, &p), &w2, tmp2.clone(), &out2, 60.0, args::MAX_PROXY_BYTES, &|e| {
            let _ = tx.lock().unwrap().send(e);
        })
    });
    let id = match rx.recv_timeout(Duration::from_secs(20)).unwrap() {
        JobEvent::Started { job_id, .. } => job_id,
        e => panic!("se esperaba Started, llegó {:?}", serde_json::to_string(&e).ok()),
    };
    // esperar a que haya progreso real y archivo temporal escrito
    let t0 = Instant::now();
    loop {
        if let Ok(JobEvent::Progress { out_time_us: Some(t), .. }) = rx.recv_timeout(Duration::from_secs(20)) {
            if t > 0 && tmp.exists() {
                break;
            }
        }
        assert!(t0.elapsed() < Duration::from_secs(30), "sin progreso");
    }
    assert_eq!(nm.lock().jobs.len(), 1);
    let tc = Instant::now();
    assert!(nm.cancel(id));
    let r = h.join().unwrap();
    assert_eq!(r, Err("cancelado".to_string()));
    assert!(tc.elapsed() < Duration::from_secs(5), "la cancelación tardó {:?}", tc.elapsed());
    assert!(!tmp.exists(), "el temporal debe borrarse");
    assert!(!out.exists());
    assert!(nm.lock().jobs.is_empty());
    assert!(!nm.cancel(id), "cancelar dos veces no hace nada");
    let _ = std::fs::remove_dir_all(&w);
}

#[test]
fn real_progress_line_cap_against_huge_output() {
    // el lector con tope no crece aunque una línea sea enorme
    let big = vec![b'x'; 5 << 20];
    let mut r = std::io::Cursor::new(big);
    let mut buf = Vec::new();
    let l = progress::read_line_capped(&mut r, &mut buf).unwrap().unwrap();
    assert_eq!(l.len(), progress::MAX_LINE);
    assert!(buf.capacity() < 1 << 20);
}

/// Herramienta de verificación manual: con `CHAMVA_PROXY_IN` y `CHAMVA_PROXY_OUT`
/// convierte cada video de la carpeta con los MISMOS argumentos que la app
/// (H.264 del sistema y VP8), para probar en Chromium que se decodifican.
#[test]
fn real_make_proxies_for_browser() {
    let (Ok(inp), Ok(outp)) = (std::env::var("CHAMVA_PROXY_IN"), std::env::var("CHAMVA_PROXY_OUT")) else { return };
    let Some(dir) = dev_dir() else { return };
    let loc = dev_located(&dir);
    let st = locate::detect(&loc, &work("mk"), None);
    let outp = PathBuf::from(outp);
    std::fs::create_dir_all(&outp).unwrap();
    for e in std::fs::read_dir(inp).unwrap().flatten() {
        let Ok(src) = validate_source(&e.path()) else { continue };
        let info = probe_ok(&loc.ffprobe, &outp, &src).unwrap();
        let stem = e.path().file_stem().unwrap().to_string_lossy().into_owned();
        for enc in [VideoEncoder::H264Mf, VideoEncoder::Libvpx] {
            if cfg!(not(windows)) && enc == VideoEncoder::H264Mf {
                continue;
            }
            let plan = ProxyPlan {
                encoder: enc,
                height: 720,
                kbps: 4500,
                fps: args::snap_fps(info.video.as_ref().unwrap().fps),
                hdr: if st.has_zscale { info.hdr_input } else { None },
                has_audio: info.audio.is_some(),
            };
            let out = outp.join(format!("{stem}.{}.{}", enc.ffmpeg_name(), enc.container().ext()));
            let tmp = out.with_extension("part");
            let nm = NativeMedia::default();
            let t = Instant::now();
            let r = run_job(&nm, &loc.ffmpeg, args::proxy_args(&src, &tmp, &plan), &outp, tmp.clone(), &out, info.duration, args::MAX_PROXY_BYTES, &|_| {});
            eprintln!("{stem} → {}: {:?} en {:?}", out.display(), r, t.elapsed());
            assert!(r.is_ok());
        }
    }
}

/// Instalación real de la copia propia desde `binaries/ffmpeg` (como si fueran los
/// recursos del instalador): SHA-256 del manifiesto, -L/-buildconf, omitir la
/// segunda vez, y `locate` acepta la copia por el sello sin releer los binarios.
#[test]
fn real_install_skip_and_locate() {
    use super::install::{self, Action};
    let Some(dir) = dev_dir() else { return };
    let Some(spec) = install::Spec::from_manifest() else {
        eprintln!("(sin build verificado para esta plataforma: se omite)");
        return;
    };
    let w = work("install");
    let dest = w.join("ffmpeg");
    let cwd = w.clone();
    let check = move |d: &Path| -> Result<(), String> {
        locate::license_check(&d.join(format!("ffmpeg{EXE}")), &d.join(format!("ffprobe{EXE}")), &cwd).map(|_| ())
    };
    let r = install::resolve(Some(&spec), Some(&dir), &dest, &check);
    assert_eq!(r.action, Action::Installed, "{r:?}");
    let t = Instant::now();
    assert_eq!(install::resolve(Some(&spec), Some(&dir), &dest, &check).action, Action::Skipped);
    assert!(t.elapsed() < Duration::from_millis(500), "omitir debe ser barato: {:?}", t.elapsed());
    let loc = locate::locate(&[(dest.clone(), Origin::Bundled, Check::Stamp)]).unwrap();
    assert_eq!(loc.origin, Origin::Bundled);
    let st = locate::detect(&loc, &w, None);
    assert!(st.available, "{:?}", st.reason);
    assert!(st.license_text.as_deref().unwrap_or("").to_ascii_uppercase().contains("GNU LESSER GENERAL PUBLIC LICENSE"));
    // los recursos también pasan la verificación completa (respaldo si la copia falla)
    assert!(locate::locate(&[(dir.clone(), Origin::Bundled, Check::FullHash)]).is_ok());
}

/// Con `CHAMVA_INSTALLED_FFMPEG=<datos locales>/com.chamva.editor/ffmpeg` (la copia que
/// preparó la app de release): la acepta `locate` por el sello, como la app instalada, y
/// hace probe + proxy (H.264 del sistema y VP8) de clips HEVC y ProRes sintéticos.
#[test]
fn real_installed_copy_probe_and_proxy() {
    let Ok(dir) = std::env::var("CHAMVA_INSTALLED_FFMPEG") else { return };
    if locate::manifest().is_blocked() {
        eprintln!("(manifiesto bloqueado: no hay copia instalada que aceptar; se omite)");
        return;
    }
    let loc = locate::locate(&[(PathBuf::from(dir), Origin::Bundled, Check::Stamp)]).expect("la copia instalada debe aceptarse por el sello");
    let w = work("installed");
    let st = locate::detect(&loc, &w, None);
    assert!(st.available, "{:?}", st.reason);
    assert_eq!(st.license.as_deref(), Some("LGPL-3.0-or-later"));
    let clips = [
        ("hevc.mp4", vec!["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000", "-t", "2", "-c:v", "libkvazaar", "-tag:v", "hvc1", "-c:a", "aac", "-shortest"], "hevc"),
        ("prores.mov", vec!["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=f=440:sample_rate=48000", "-t", "2", "-c:v", "prores_ks", "-profile:v", "3", "-c:a", "pcm_s16le", "-shortest"], "prores"),
    ];
    for (name, extra, codec) in clips {
        let src = w.join(name);
        gen(&loc.ffmpeg, &w, &src, &extra);
        let canon = validate_source(&src).unwrap();
        let info = probe_ok(&loc.ffprobe, &w, &canon).unwrap();
        assert_eq!(info.video.as_ref().unwrap().codec, codec);
        for enc in [VideoEncoder::H264Mf, VideoEncoder::Libvpx] {
            if cfg!(not(windows)) && enc == VideoEncoder::H264Mf {
                continue;
            }
            let plan = ProxyPlan { encoder: enc, height: 360, kbps: 1200, fps: args::snap_fps(info.video.as_ref().unwrap().fps), hdr: None, has_audio: true };
            let out = w.join(format!("{name}.{}.{}", enc.ffmpeg_name(), enc.container().ext()));
            let tmp = out.with_extension("part");
            let nm = NativeMedia::default();
            let r = run_job(&nm, &loc.ffmpeg, args::proxy_args(&canon, &tmp, &plan), &w, tmp.clone(), &out, info.duration, args::MAX_PROXY_BYTES, &|_| {});
            assert!(r.is_ok(), "{name} → {}: {r:?}", enc.ffmpeg_name());
            let pi = probe_ok(&loc.ffprobe, &w, &validate_source(&out).unwrap()).unwrap();
            eprintln!("{name} ({codec}) → {} : {} {}x{} {:.2}s", enc.ffmpeg_name(), pi.video.as_ref().unwrap().codec, pi.video.as_ref().unwrap().width, pi.video.as_ref().unwrap().height, pi.duration);
            assert_eq!(pi.video.as_ref().unwrap().height, 360);
        }
    }
    let _ = std::fs::remove_dir_all(&w);
}
