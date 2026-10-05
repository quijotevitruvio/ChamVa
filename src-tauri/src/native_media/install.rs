//! Copia propia de FFmpeg de la app: «si ya está y es la misma versión, se omite».
//!
//! Un instalador construido con `tauri.ffmpeg.conf.json` deja el build fijado en
//! `<recursos>/ffmpeg/` (carpeta del programa: solo lectura en instalaciones
//! por máquina): desde v0.9.1, el build propio LGPL-2.1-or-later de Windows x64
//! (el BtbN de v0.9.0 sigue en `revoked` y no se ejecuta nunca). Si el manifiesto
//! está bloqueado o no fija esta plataforma, `Spec::from_manifest()` da `None` y aquí
//! no se copia ni se ejecuta nada (ver docs/seguridad-ffmpeg.md). La app trabaja con SU copia en `<datos locales>/ffmpeg/`
//! (siempre escribible por el usuario, sin permisos de administrador):
//!
//! - En cada arranque se hace la comprobación BARATA (`check_stamp`): el sello
//!   `CHAMVA-FFMPEG.json` dice versión + SHA-256 del zip + SHA-256, tamaño y
//!   fecha de cada archivo; debe coincidir con el manifiesto compilado en la app
//!   y con lo que hay en disco (tamaño y fecha), sin archivos de más ni enlaces.
//!   No se relee ningún binario: si todo coincide, NO se copia nada.
//! - Si falta, está dañada (tamaño/fecha distintos, archivo de más o de menos)
//!   o el manifiesto cambió (nueva versión de ChamVa con otro FFmpeg), se
//!   REPARA desde los recursos: copia a una carpeta temporal calculando el
//!   SHA-256 de cada archivo mientras copia, exige que coincida con el
//!   manifiesto y que haya licencia LGPL, comprueba `-L`/`-buildconf` del
//!   binario copiado y solo entonces sustituye la carpeta (renombrado).
//! - Sin recursos (macOS/Linux/Android o instalador sin FFmpeg) no se toca nada:
//!   la app funciona como siempre.
//!
//! Nunca se usa un FFmpeg del PATH ni de otra ruta.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::locate::{hex, EXE};

/// Sello de la copia instalada (lo escribe solo `install_from`).
pub const STAMP: &str = "CHAMVA-FFMPEG.json";
const STAMP_SCHEMA: u32 = 1;
const MAX_STAMP: u64 = 64 * 1024;
/// Licencia obligatoria (texto LGPL de FFmpeg) y aviso opcional.
pub const LICENSE: &str = "LICENSE.txt";
const NOTICE: &str = "AVISO-FFMPEG.txt";
/// Archivos que no se ejecutan y pueden acompañar a los binarios.
pub const EXTRA_OK: &[&str] = &[LICENSE, NOTICE, "BUILD-INFO.json", STAMP];

/// Lo que se espera instalar (sale del manifiesto; en pruebas, de datos falsos).
#[derive(Debug, Clone)]
pub struct Spec {
    pub version: String,
    pub archive_sha256: String,
    /// nombre → SHA-256
    pub files: BTreeMap<String, String>,
}

impl Spec {
    /// Build verificado de esta plataforma (None si no lo hay: macOS, Linux, ARM…,
    /// o si el manifiesto lo marca como bloqueado).
    pub fn from_manifest() -> Option<Spec> {
        Self::from_target(super::locate::manifest(), super::locate::TRIPLE)
    }

    /// `from_manifest` con un manifiesto y una plataforma explícitos (pruebas).
    pub fn from_target(m: &super::locate::Manifest, triple: &str) -> Option<Spec> {
        let t = m.target(triple)?; // None si está bloqueado
        if !t.verified {
            return None;
        }
        let files = t.files.clone()?;
        if files.is_empty() || !files.contains_key(&format!("ffmpeg{EXE}")) || !files.contains_key(&format!("ffprobe{EXE}")) {
            return None;
        }
        Some(Spec { version: m.version.clone(), archive_sha256: t.sha256.clone(), files })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StampFile {
    sha256: String,
    size: u64,
    mtime_ns: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stamp {
    schema: u32,
    version: String,
    archive_sha256: String,
    files: BTreeMap<String, StampFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    /// la copia instalada coincide: no se copió nada
    Skipped,
    /// no había copia: se instaló desde los recursos
    Installed,
    /// había una copia distinta o dañada: se sustituyó
    Repaired,
    /// esta copia de ChamVa no trae FFmpeg (o no hay build verificado)
    Unavailable,
    /// había que instalar/reparar y no se pudo
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub action: Action,
    /// motivo legible (por qué se reparó, por qué falló…)
    pub detail: Option<String>,
}

impl Report {
    fn new(action: Action, detail: impl Into<Option<String>>) -> Self {
        Report { action, detail: detail.into() }
    }
}

fn mtime_ns(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos() as u64).unwrap_or(0)
}

/// Comprobación barata de la copia instalada: sello + listado + tamaños y fechas.
/// No lee el contenido de los binarios.
pub fn check_stamp(dir: &Path, spec: &Spec) -> Result<(), String> {
    let sp = dir.join(STAMP);
    let meta = std::fs::symlink_metadata(&sp).map_err(|_| "no está instalada".to_string())?;
    if !meta.is_file() || meta.len() > MAX_STAMP {
        return Err("sello no válido".into());
    }
    let stamp: Stamp = serde_json::from_slice(&std::fs::read(&sp).map_err(|_| "sello ilegible".to_string())?).map_err(|_| "sello no válido".to_string())?;
    if stamp.schema != STAMP_SCHEMA {
        return Err("sello de otra versión de ChamVa".into());
    }
    if stamp.version != spec.version || stamp.archive_sha256 != spec.archive_sha256 {
        return Err(format!("versión distinta (instalada {}, esperada {})", stamp.version.chars().take(60).collect::<String>(), spec.version));
    }
    let same_set = stamp.files.len() == spec.files.len() && spec.files.iter().all(|(n, h)| stamp.files.get(n).is_some_and(|f| &f.sha256 == h));
    if !same_set {
        return Err("los archivos no son los del manifiesto".into());
    }
    let rd = std::fs::read_dir(dir).map_err(|_| "no se puede leer la carpeta".to_string())?;
    for e in rd {
        let e = e.map_err(|_| "no se puede leer la carpeta".to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if !spec.files.contains_key(&name) && !EXTRA_OK.contains(&name.as_str()) {
            return Err(format!("archivo no esperado: {}", name.chars().take(80).collect::<String>()));
        }
        // symlink_metadata: un enlace simbólico o una junta no cuentan como archivo
        let m = std::fs::symlink_metadata(e.path()).map_err(|_| "no se puede leer la carpeta".to_string())?;
        if !m.is_file() {
            return Err(format!("«{}» no es un archivo normal", name.chars().take(80).collect::<String>()));
        }
    }
    if !dir.join(LICENSE).is_file() {
        return Err("falta la licencia".into());
    }
    for (name, f) in &stamp.files {
        let m = std::fs::symlink_metadata(dir.join(name)).map_err(|_| format!("falta {name}"))?;
        if !m.is_file() || m.len() != f.size || mtime_ns(&m) != f.mtime_ns {
            return Err(format!("{name} cambió desde la instalación"));
        }
    }
    Ok(())
}

/// Copia `src` → `dst` calculando el SHA-256 de lo copiado.
fn copy_hashed(src: &Path, dst: &Path) -> std::io::Result<String> {
    let mut i = std::fs::File::open(src)?;
    let mut o = std::fs::OpenOptions::new().write(true).create_new(true).open(dst)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = i.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        o.write_all(&buf[..n])?;
    }
    o.sync_all()?;
    Ok(hex(&h.finalize()))
}

fn sibling(dest: &Path, tag: &str) -> PathBuf {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "ffmpeg".into());
    dest.with_file_name(format!("{name}.{tag}-{}", std::process::id()))
}

/// Borra restos de instalaciones interrumpidas (`ffmpeg.staging-*`, `ffmpeg.old-*`)
/// de más de 10 minutos (las recientes pueden ser de otra ventana de ChamVa).
fn clean_leftovers(dest: &Path) {
    let (Some(parent), Some(name)) = (dest.parent(), dest.file_name().map(|n| n.to_string_lossy().into_owned())) else {
        return;
    };
    let Ok(rd) = std::fs::read_dir(parent) else { return };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if !(n.starts_with(&format!("{name}.staging-")) || n.starts_with(&format!("{name}.old-"))) {
            continue;
        }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| SystemTime::now().duration_since(t).ok()).is_some_and(|d| d > Duration::from_secs(600));
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// Instala (o sustituye) `dest` con los archivos de `src` verificados contra `spec`.
/// `license_check` recibe la carpeta ya copiada (aún temporal) y debe confirmar que
/// el binario es LGPL (`-L`/`-buildconf`). Si algo falla, `dest` queda como estaba.
pub fn install_from(src: &Path, dest: &Path, spec: &Spec, license_check: &dyn Fn(&Path) -> Result<(), String>) -> Result<(), String> {
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("no se pudo crear la carpeta de datos: {e}"))?;
    }
    let staging = sibling(dest, "staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir(&staging).map_err(|e| format!("no se pudo crear la carpeta temporal: {e}"))?;
    let res = (|| -> Result<(), String> {
        let mut files = BTreeMap::new();
        for (name, want) in &spec.files {
            let s = src.join(name);
            let m = std::fs::symlink_metadata(&s).map_err(|_| format!("al instalador le falta {name}"))?;
            if !m.is_file() {
                return Err(format!("«{name}» del instalador no es un archivo normal"));
            }
            let got = copy_hashed(&s, &staging.join(name)).map_err(|e| format!("no se pudo copiar {name}: {e}"))?;
            if &got != want {
                return Err(format!("{name} del instalador está dañado (SHA-256 distinto)"));
            }
        }
        // licencia LGPL obligatoria; aviso opcional (archivos pequeños)
        let lic = src.join(LICENSE);
        let lm = std::fs::symlink_metadata(&lic).map_err(|_| "al instalador le falta la licencia de FFmpeg".to_string())?;
        if !lm.is_file() || lm.len() > 1 << 20 {
            return Err("la licencia de FFmpeg del instalador no es válida".into());
        }
        let text = std::fs::read_to_string(&lic).map_err(|_| "licencia de FFmpeg ilegible".to_string())?;
        if !text.to_ascii_uppercase().contains("GNU LESSER GENERAL PUBLIC LICENSE") {
            return Err("la licencia de FFmpeg del instalador no es la LGPL".into());
        }
        copy_hashed(&lic, &staging.join(LICENSE)).map_err(|e| format!("no se pudo copiar la licencia: {e}"))?;
        let notice = src.join(NOTICE);
        if std::fs::symlink_metadata(&notice).is_ok_and(|m| m.is_file() && m.len() <= 1 << 20) {
            copy_hashed(&notice, &staging.join(NOTICE)).map_err(|e| format!("no se pudo copiar el aviso: {e}"))?;
        }
        license_check(&staging)?;
        for (name, want) in &spec.files {
            let m = std::fs::symlink_metadata(staging.join(name)).map_err(|_| format!("falta {name}"))?;
            files.insert(name.clone(), StampFile { sha256: want.clone(), size: m.len(), mtime_ns: mtime_ns(&m) });
        }
        let stamp = Stamp { schema: STAMP_SCHEMA, version: spec.version.clone(), archive_sha256: spec.archive_sha256.clone(), files };
        std::fs::write(staging.join(STAMP), serde_json::to_vec_pretty(&stamp).map_err(|e| e.to_string())?).map_err(|e| format!("no se pudo escribir el sello: {e}"))?;
        // sustitución: la carpeta vieja se aparta, la nueva ocupa su sitio
        let old = sibling(dest, "old");
        let had = std::fs::symlink_metadata(dest).is_ok();
        if had {
            let _ = std::fs::remove_dir_all(&old);
            if std::fs::symlink_metadata(dest).is_ok_and(|m| !m.is_dir()) {
                std::fs::remove_file(dest).map_err(|e| format!("no se pudo apartar la copia anterior: {e}"))?;
            } else {
                std::fs::rename(dest, &old).map_err(|e| format!("no se pudo apartar la copia anterior (¿FFmpeg en uso por otra ventana de ChamVa?): {e}"))?;
            }
        }
        if let Err(e) = std::fs::rename(&staging, dest) {
            if had && std::fs::symlink_metadata(&old).is_ok() {
                let _ = std::fs::rename(&old, dest);
            }
            return Err(format!("no se pudo colocar la copia nueva: {e}"));
        }
        let _ = std::fs::remove_dir_all(&old);
        Ok(())
    })();
    if res.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    res
}

/// Decide y ejecuta: omitir si coincide, instalar/reparar desde `resources` si no.
/// `resources` es `<recursos de la app>/ffmpeg` (puede no existir).
pub fn resolve(spec: Option<&Spec>, resources: Option<&Path>, dest: &Path, license_check: &dyn Fn(&Path) -> Result<(), String>) -> Report {
    let Some(spec) = spec else {
        // sin build utilizable (bloqueado por el manifiesto o sin entrada para esta
        // plataforma): no se copia ni se ejecuta nada
        let why = super::locate::manifest_unavailable(super::locate::manifest(), super::locate::TRIPLE).unwrap_or(super::locate::NOT_AVAILABLE_PLATFORM);
        return Report::new(Action::Unavailable, Some(why.into()));
    };
    clean_leftovers(dest);
    let why = match check_stamp(dest, spec) {
        Ok(()) => return Report::new(Action::Skipped, None),
        Err(e) => e,
    };
    let bundled = resources.filter(|r| r.join(format!("ffmpeg{EXE}")).is_file());
    let Some(src) = bundled else {
        return Report::new(Action::Unavailable, Some("esta copia de ChamVa no incluye FFmpeg".into()));
    };
    let existed = std::fs::symlink_metadata(dest).is_ok();
    match install_from(src, dest, spec, license_check) {
        Ok(()) if existed => Report::new(Action::Repaired, Some(format!("se reparó la copia de FFmpeg: {why}"))),
        Ok(()) => Report::new(Action::Installed, None),
        Err(e) => Report::new(Action::Failed, Some(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LGPL_TEXT: &str = "GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n";

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chamva-install-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn sha(b: &[u8]) -> String {
        hex(&Sha256::digest(b))
    }

    /// Recursos falsos («instalador») con 3 archivos + licencia, y su Spec.
    fn fake_resources(root: &Path, version: &str, salt: &str) -> (PathBuf, Spec) {
        let r = root.join(format!("res-{version}"));
        std::fs::create_dir_all(&r).unwrap();
        let mut files = BTreeMap::new();
        for name in [format!("ffmpeg{EXE}"), format!("ffprobe{EXE}"), "avcodec-63.dll".to_string()] {
            let body = format!("{name}:{version}:{salt}").repeat(1000);
            std::fs::write(r.join(&name), &body).unwrap();
            files.insert(name, sha(body.as_bytes()));
        }
        std::fs::write(r.join(LICENSE), LGPL_TEXT).unwrap();
        std::fs::write(r.join(NOTICE), "aviso").unwrap();
        std::fs::write(r.join("BUILD-INFO.json"), "{}").unwrap();
        (r, Spec { version: version.into(), archive_sha256: sha(version.as_bytes()), files })
    }

    fn ok(_: &Path) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn install_then_skip_without_copying() {
        let root = tmp("skip");
        let (res, spec) = fake_resources(&root, "n9.0.2", "a");
        let dest = root.join("data").join("ffmpeg");
        let r = resolve(Some(&spec), Some(&res), &dest, &ok);
        assert_eq!(r.action, Action::Installed, "{r:?}");
        assert!(check_stamp(&dest, &spec).is_ok());
        assert!(dest.join(LICENSE).is_file() && dest.join(NOTICE).is_file() && dest.join(STAMP).is_file());
        assert!(!dest.join("BUILD-INFO.json").exists(), "solo se copia lo necesario");
        let before: Vec<_> = spec.files.keys().map(|n| std::fs::metadata(dest.join(n)).unwrap().modified().unwrap()).collect();
        // segunda vez: misma versión → se omite, y la comprobación de licencia ni se llama
        let called = std::cell::Cell::new(false);
        let probe = |_: &Path| -> Result<(), String> {
            called.set(true);
            Ok(())
        };
        let r = resolve(Some(&spec), Some(&res), &dest, &probe);
        assert_eq!(r.action, Action::Skipped);
        assert!(!called.get(), "omitir no debe ejecutar nada");
        let after: Vec<_> = spec.files.keys().map(|n| std::fs::metadata(dest.join(n)).unwrap().modified().unwrap()).collect();
        assert_eq!(before, after, "omitir no debe reescribir archivos");
        // también se omite aunque los recursos ya no estén (p. ej. carpeta del programa movida)
        assert_eq!(resolve(Some(&spec), None, &dest, &ok).action, Action::Skipped);
    }

    #[test]
    fn damaged_copy_is_repaired() {
        let root = tmp("damaged");
        let (res, spec) = fake_resources(&root, "n9.0.2", "a");
        let dest = root.join("ffmpeg");
        assert_eq!(resolve(Some(&spec), Some(&res), &dest, &ok).action, Action::Installed);
        // archivo alterado (otro contenido, otra fecha)
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(dest.join("avcodec-63.dll"), b"troyano").unwrap();
        assert!(check_stamp(&dest, &spec).is_err());
        let r = resolve(Some(&spec), Some(&res), &dest, &ok);
        assert_eq!(r.action, Action::Repaired, "{r:?}");
        assert!(r.detail.unwrap().contains("avcodec-63.dll"));
        assert_eq!(super::super::locate::sha256_file(&dest.join("avcodec-63.dll")).unwrap(), spec.files["avcodec-63.dll"]);
        // archivo ausente
        std::fs::remove_file(dest.join(format!("ffprobe{EXE}"))).unwrap();
        assert_eq!(resolve(Some(&spec), Some(&res), &dest, &ok).action, Action::Repaired);
        assert!(check_stamp(&dest, &spec).is_ok());
        // DLL plantada junto a ffmpeg.exe: se repara y desaparece
        std::fs::write(dest.join("version.dll"), b"plantada").unwrap();
        let r = resolve(Some(&spec), Some(&res), &dest, &ok);
        assert_eq!(r.action, Action::Repaired);
        assert!(!dest.join("version.dll").exists());
        // sello manipulado / basura
        std::fs::write(dest.join(STAMP), b"{\"schema\":1}").unwrap();
        assert_eq!(resolve(Some(&spec), Some(&res), &dest, &ok).action, Action::Repaired);
        // sin licencia
        std::fs::remove_file(dest.join(LICENSE)).unwrap();
        assert_eq!(resolve(Some(&spec), Some(&res), &dest, &ok).action, Action::Repaired);
        assert!(check_stamp(&dest, &spec).is_ok());
    }

    #[test]
    fn other_manifest_replaces() {
        let root = tmp("manifest");
        let (res1, spec1) = fake_resources(&root, "n9.0.2", "a");
        let (res2, spec2) = fake_resources(&root, "n9.1.0", "b");
        let dest = root.join("ffmpeg");
        assert_eq!(resolve(Some(&spec1), Some(&res1), &dest, &ok).action, Action::Installed);
        // nueva versión de ChamVa con otro FFmpeg: la copia vieja no sirve y se sustituye
        let e = check_stamp(&dest, &spec2).unwrap_err();
        assert!(e.contains("versión distinta"), "{e}");
        let r = resolve(Some(&spec2), Some(&res2), &dest, &ok);
        assert_eq!(r.action, Action::Repaired, "{r:?}");
        assert!(check_stamp(&dest, &spec2).is_ok());
        assert!(check_stamp(&dest, &spec1).is_err());
        // mismo número de versión pero hashes distintos (manifiesto corregido) → también se sustituye
        let mut spec3 = spec2.clone();
        spec3.files.insert("avcodec-63.dll".into(), sha(b"otro"));
        assert!(check_stamp(&dest, &spec3).is_err());
    }

    #[test]
    fn bad_resources_never_replace() {
        let root = tmp("badres");
        let (res, spec) = fake_resources(&root, "n9.0.2", "a");
        let dest = root.join("ffmpeg");
        // recursos dañados: falla, no crea nada y no deja temporales
        std::fs::write(res.join("avcodec-63.dll"), b"corrupto").unwrap();
        let r = resolve(Some(&spec), Some(&res), &dest, &ok);
        assert_eq!(r.action, Action::Failed);
        assert!(r.detail.unwrap().contains("dañado"));
        assert!(!dest.exists());
        let left: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.contains("staging")).collect();
        assert!(left.is_empty(), "{left:?}");
        // instalación buena, después la comprobación de licencia falla: la copia buena no se toca
        let (res2, spec2) = fake_resources(&root, "n9.0.3", "c");
        assert_eq!(resolve(Some(&spec2), Some(&res2), &dest, &ok).action, Action::Installed);
        let (res3, spec3) = fake_resources(&root, "n9.0.4", "d");
        let gpl = |_: &Path| -> Result<(), String> { Err("el binario está compilado con --enable-gpl".into()) };
        let r = resolve(Some(&spec3), Some(&res3), &dest, &gpl);
        assert_eq!(r.action, Action::Failed);
        assert!(check_stamp(&dest, &spec2).is_ok(), "la copia anterior sigue intacta");
        // licencia que no es LGPL en los recursos
        std::fs::write(res3.join(LICENSE), "GNU GENERAL PUBLIC LICENSE").unwrap();
        assert_eq!(resolve(Some(&spec3), Some(&res3), &dest, &ok).action, Action::Failed);
        // sin licencia en los recursos
        std::fs::remove_file(res3.join(LICENSE)).unwrap();
        assert_eq!(resolve(Some(&spec3), Some(&res3), &dest, &ok).action, Action::Failed);
    }

    #[test]
    fn without_resources_or_build_nothing_changes() {
        let root = tmp("none");
        let (_res, spec) = fake_resources(&root, "n9.0.2", "a");
        let dest = root.join("ffmpeg");
        assert_eq!(resolve(Some(&spec), None, &dest, &ok).action, Action::Unavailable);
        assert_eq!(resolve(Some(&spec), Some(&root.join("no-existe")), &dest, &ok).action, Action::Unavailable);
        assert_eq!(resolve(None, None, &dest, &ok).action, Action::Unavailable);
        assert!(!dest.exists());
    }

    #[test]
    fn stale_leftovers_are_cleaned() {
        let root = tmp("left");
        let (res, spec) = fake_resources(&root, "n9.0.2", "a");
        let dest = root.join("ffmpeg");
        let stale = root.join("ffmpeg.staging-1");
        std::fs::create_dir_all(&stale).unwrap();
        // recién creada: puede ser de otra ventana → se respeta
        assert_eq!(resolve(Some(&spec), Some(&res), &dest, &ok).action, Action::Installed);
        assert!(stale.exists());
        // carpetas ajenas al patrón nunca se tocan
        assert!(res.exists());
    }

    /// Manifiesto bloqueado (plantilla «pending-build» del build propio, candidato
    /// «pending-review»…) → no hay Spec en ninguna plataforma.
    #[test]
    fn blocked_manifest_has_no_spec() {
        if super::super::locate::manifest().is_blocked() {
            assert!(Spec::from_manifest().is_none());
        }
        let pending = r#"{"status":"pending-build","version":"n9","release":"r","ffmpegSource":"s","buildScripts":"b","targets":{}}"#;
        assert!(serde_json::from_str::<super::super::locate::Manifest>(pending).unwrap().is_blocked());
    }

    /// Manifiesto con la entrada bloqueada: `resolve` no copia ni ejecuta nada,
    /// aunque los «recursos del instalador» traigan los archivos exactos.
    #[test]
    fn blocked_entry_is_unavailable_and_never_runs() {
        let root = tmp("blocked");
        let (res, spec) = fake_resources(&root, "n9.0.2", "a");
        let files: serde_json::Map<String, serde_json::Value> = spec.files.iter().map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone()))).collect();
        let triple = super::super::locate::TRIPLE;
        for (top, per) in [("\"status\":\"blocked-license\",", ""), ("", "\"status\":\"blocked-license\",")] {
            let json = format!(
                r#"{{{top}"version":"n9.0.2","release":"r","ffmpegSource":"s","buildScripts":"b","targets":{{"{triple}":{{{per}"url":"u","sha256":"{}","verified":true,"files":{}}}}}}}"#,
                spec.archive_sha256,
                serde_json::Value::Object(files.clone())
            );
            let m: super::super::locate::Manifest = serde_json::from_str(&json).unwrap();
            assert!(m.target(triple).is_none());
            assert!(m.user_files(triple).is_empty());
            let s = Spec::from_target(&m, triple);
            assert!(s.is_none(), "una entrada bloqueada no da Spec");
            let called = std::cell::Cell::new(false);
            let probe = |_: &Path| -> Result<(), String> {
                called.set(true);
                Ok(())
            };
            let dest = root.join("data").join("ffmpeg");
            let r = resolve(s.as_ref(), Some(&res), &dest, &probe);
            assert_eq!(r.action, Action::Unavailable);
            assert!(r.detail.is_some());
            assert!(!called.get(), "jamás se ejecuta el binario");
            assert!(!dest.exists(), "no se copia nada");
        }
        // estado desconocido: también bloquea (falla cerrado); «ok» no
        let ok_json = r#"{"status":"ok","version":"v","release":"r","ffmpegSource":"s","buildScripts":"b","targets":{}}"#;
        assert!(!serde_json::from_str::<super::super::locate::Manifest>(ok_json).unwrap().is_blocked());
        let odd = ok_json.replace("\"ok\"", "\"en-revision\"");
        assert!(serde_json::from_str::<super::super::locate::Manifest>(&odd).unwrap().is_blocked());
    }
}
