//! Dónde está ffmpeg y si se puede usar.
//!
//! Solo se ejecuta un binario en estas rutas FIJAS (nunca el PATH, nunca una
//! ruta que diga la interfaz), por orden:
//! 1. `<recursos de la app>/ffmpeg/` — copiado por el instalador;
//! 2. `<datos locales de la app>/ffmpeg/` — instalado a mano por el usuario;
//!    SOLO se acepta si cada archivo coincide con los SHA-256 fijados abajo y
//!    no hay archivos extra (evita DLL plantadas junto a ffmpeg.exe);
//! 3. en compilaciones de desarrollo, `src-tauri/binaries/ffmpeg/`.
//! Y en todos los casos el binario debe declararse LGPL (`-L`) y su
//! configuración (`-buildconf`) no puede llevar `--enable-gpl` ni `--enable-nonfree`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::args::HwEncoder;
use super::process::{command, run_capture};

#[cfg(windows)]
pub const EXE: &str = ".exe";
#[cfg(not(windows))]
pub const EXE: &str = "";

/// Manifiesto único del build fijado (lo comparte `scripts/fetch-ffmpeg.mjs`).
const MANIFEST_JSON: &str = include_str!("../../ffmpeg-manifest.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTarget {
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub verified: bool,
    pub files: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub release: String,
    pub ffmpeg_source: String,
    pub build_scripts: String,
    pub targets: BTreeMap<String, ManifestTarget>,
}

pub fn manifest() -> &'static Manifest {
    static M: OnceLock<Manifest> = OnceLock::new();
    M.get_or_init(|| serde_json::from_str(MANIFEST_JSON).expect("ffmpeg-manifest.json no válido"))
}

/// Entrada del manifiesto para la plataforma para la que se compiló la app.
pub fn this_target() -> Option<&'static ManifestTarget> {
    manifest().targets.get(env!("CHAMVA_TARGET_TRIPLE"))
}

/// Archivos exactos (nombre, SHA-256) que se aceptan en la carpeta del usuario:
/// solo si el build de esta plataforma está verificado y tiene hashes fijados.
pub fn user_manifest() -> Vec<(&'static str, &'static str)> {
    match this_target() {
        Some(t) if t.verified => t.files.as_ref().map(|f| f.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()).unwrap_or_default(),
        _ => vec![],
    }
}

/// Archivos que pueden acompañar a los binarios en la carpeta del usuario sin ejecutarse.
const USER_EXTRA_OK: &[&str] = &["LICENSE.txt", "BUILD-INFO.json", "AVISO-FFMPEG.txt"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Bundled,
    User,
    Dev,
}

#[derive(Debug, Clone)]
pub struct Located {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub origin: Origin,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStatus {
    pub available: bool,
    /// motivo legible si no está disponible
    pub reason: Option<String>,
    pub origin: Option<Origin>,
    pub version: Option<String>,
    pub license: Option<String>,
    /// encoders H.264 por hardware/sistema LISTADOS por `-encoders` (no probados)
    pub listed_hw_encoders: Vec<HwEncoder>,
    pub has_libvpx: bool,
    pub has_zscale: bool,
    /// carpeta donde el usuario puede colocar el build verificado
    pub user_dir: Option<String>,
    /// build fijado para esta plataforma (si lo hay): descarga y SHA-256 publicados
    pub pinned_source_url: Option<String>,
    pub pinned_sha256: Option<String>,
    pub pinned_version: String,
    pub release_url: String,
    pub ffmpeg_source_url: String,
    pub build_scripts_url: String,
    pub user_install_supported: bool,
}

impl NativeStatus {
    pub fn unavailable(reason: impl Into<String>, user_dir: Option<String>) -> Self {
        NativeStatus {
            available: false,
            reason: Some(reason.into()),
            origin: None,
            version: None,
            license: None,
            listed_hw_encoders: vec![],
            has_libvpx: false,
            has_zscale: false,
            user_dir,
            pinned_source_url: this_target().map(|t| t.url.clone()),
            pinned_sha256: this_target().map(|t| t.sha256.clone()),
            pinned_version: manifest().version.clone(),
            release_url: manifest().release.clone(),
            ffmpeg_source_url: manifest().ffmpeg_source.clone(),
            build_scripts_url: manifest().build_scripts.clone(),
            user_install_supported: !user_manifest().is_empty(),
        }
    }
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Comprueba la carpeta del usuario contra el manifiesto fijado.
pub fn verify_user_dir(dir: &Path) -> Result<(), String> {
    let um = user_manifest();
    if um.is_empty() {
        return Err("en esta plataforma no hay un build verificado para instalar a mano".into());
    }
    let entries = std::fs::read_dir(dir).map_err(|_| "no se puede leer la carpeta".to_string())?;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let known = um.iter().any(|(n, _)| *n == name) || USER_EXTRA_OK.contains(&name.as_str());
        if !known {
            return Err(format!("archivo no esperado en la carpeta de FFmpeg: {name}"));
        }
        let ft = e.file_type().map_err(|_| "no se puede leer la carpeta".to_string())?;
        if !ft.is_file() {
            return Err(format!("«{name}» no es un archivo normal"));
        }
    }
    for (name, want) in &um {
        let got = sha256_file(&dir.join(name)).map_err(|_| format!("falta {name}"))?;
        if got != *want {
            return Err(format!("{name} no coincide con el SHA-256 publicado"));
        }
    }
    Ok(())
}

pub fn candidates(resource_dir: Option<PathBuf>, user_dir: Option<PathBuf>) -> Vec<(PathBuf, Origin)> {
    let mut v = Vec::new();
    if let Some(r) = resource_dir {
        v.push((r.join("ffmpeg"), Origin::Bundled));
    }
    if let Some(u) = user_dir {
        v.push((u, Origin::User));
    }
    #[cfg(debug_assertions)]
    v.push((PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg"), Origin::Dev));
    v
}

pub fn locate(cands: &[(PathBuf, Origin)]) -> Result<Located, String> {
    let mut last = "FFmpeg no está instalado en esta copia de ChamVa".to_string();
    for (dir, origin) in cands {
        let ffmpeg = dir.join(format!("ffmpeg{EXE}"));
        let ffprobe = dir.join(format!("ffprobe{EXE}"));
        if !(ffmpeg.is_file() && ffprobe.is_file()) {
            continue;
        }
        if *origin == Origin::User {
            if let Err(e) = verify_user_dir(dir) {
                last = format!("La copia de FFmpeg de tu carpeta no es la verificada: {e}");
                continue;
            }
        }
        return Ok(Located { ffmpeg, ffprobe, origin: *origin });
    }
    Err(last)
}

/// ¿El texto de `-L` y `-buildconf` corresponde a un build LGPL sin partes GPL/no libres?
pub fn license_ok(l_text: &str, buildconf: &str) -> Result<String, String> {
    let l = l_text.to_ascii_lowercase();
    if !l.contains("gnu lesser general public license") {
        return Err("el binario no se declara LGPL".into());
    }
    let bc = buildconf.to_ascii_lowercase();
    for bad in ["--enable-gpl", "--enable-nonfree", "--enable-libx264", "--enable-libx265", "--enable-libvidstab", "--enable-libfdk-aac", "--enable-libxvid"] {
        if bc.split_whitespace().any(|t| t == bad) {
            return Err(format!("el binario está compilado con {bad}"));
        }
    }
    let v3 = l.contains("version 3");
    Ok(if v3 { "LGPL-3.0-or-later".into() } else { "LGPL-2.1-or-later".into() })
}

/// Nombres de la columna 2 de `ffmpeg -encoders` / `-filters`.
pub fn listed_names(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let flags = it.next()?;
            let name = it.next()?;
            if flags.len() == 6 && flags.chars().all(|c| c.is_ascii_uppercase() || c == '.' || c == '|') {
                Some(name.to_string())
            } else if (2..=3).contains(&flags.len()) && flags.chars().all(|c| matches!(c, 'T' | 'S' | 'C' | '.')) {
                Some(name.to_string()) // formato de -filters
            } else {
                None
            }
        })
        .collect()
}

fn run_text(bin: &Path, cwd: &Path, args: &[&str]) -> Result<String, String> {
    let a: Vec<_> = args.iter().map(|s| (*s).into()).collect();
    let out = run_capture(command(bin, &a, cwd), Duration::from_secs(15), 1 << 20, 64 << 10).map_err(|e| format!("no se pudo ejecutar FFmpeg: {e}"))?;
    if out.timed_out {
        return Err("FFmpeg no respondió a tiempo".into());
    }
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    s.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(s)
}

/// Detección completa. `cwd` es el directorio temporal propio.
pub fn detect(loc: &Located, cwd: &Path, user_dir: Option<String>) -> NativeStatus {
    let check = || -> Result<NativeStatus, String> {
        let l = run_text(&loc.ffmpeg, cwd, &["-hide_banner", "-L"])?;
        let bc = run_text(&loc.ffmpeg, cwd, &["-hide_banner", "-buildconf"])?;
        let license = license_ok(&l, &bc)?;
        let lp = run_text(&loc.ffprobe, cwd, &["-hide_banner", "-L"])?;
        let bcp = run_text(&loc.ffprobe, cwd, &["-hide_banner", "-buildconf"])?;
        license_ok(&lp, &bcp).map_err(|e| format!("ffprobe: {e}"))?;
        let ver = run_text(&loc.ffmpeg, cwd, &["-hide_banner", "-version"])?;
        let version = ver.lines().next().unwrap_or("").chars().take(120).collect::<String>();
        let enc = listed_names(&run_text(&loc.ffmpeg, cwd, &["-hide_banner", "-encoders"])?);
        let filters = listed_names(&run_text(&loc.ffmpeg, cwd, &["-hide_banner", "-filters"])?);
        let listed_hw_encoders = HwEncoder::ALL.into_iter().filter(|e| enc.iter().any(|n| n == e.ffmpeg_name())).collect();
        Ok(NativeStatus {
            available: true,
            reason: None,
            origin: Some(loc.origin),
            version: Some(version),
            license: Some(license),
            listed_hw_encoders,
            has_libvpx: enc.iter().any(|n| n == "libvpx"),
            has_zscale: filters.iter().any(|n| n == "zscale") && filters.iter().any(|n| n == "tonemap"),
            ..NativeStatus::unavailable("", user_dir.clone())
        })
    };
    match check() {
        Ok(s) => s,
        Err(e) => NativeStatus::unavailable(e, user_dir),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LGPL: &str = "ffmpeg is free software; you can redistribute it and/or modify\nit under the terms of the GNU Lesser General Public License as published by\nthe Free Software Foundation; either version 3 of the License, or";
    const GPL: &str = "ffmpeg is free software; you can redistribute it and/or modify\nit under the terms of the GNU General Public License as published by\nthe Free Software Foundation; either version 3 of the License, or";

    #[test]
    fn license_checks() {
        assert_eq!(license_ok(LGPL, "--enable-version3 --disable-libx264").unwrap(), "LGPL-3.0-or-later");
        assert!(license_ok(GPL, "--enable-version3").is_err());
        assert!(license_ok(LGPL, "--enable-gpl --enable-version3").is_err());
        assert!(license_ok(LGPL, "  --enable-nonfree").is_err());
        assert!(license_ok(LGPL, "--enable-libx264").is_err());
        assert!(license_ok(LGPL, "--enable-libfdk-aac").is_err());
        // «--disable-libx264» o «--enable-gplv3-algo» inventado no confunden la comprobación
        assert!(license_ok(LGPL, "--disable-libx264 --disable-libx265 --disable-libfdk-aac").is_ok());
        assert!(license_ok("", "").is_err());
    }

    #[test]
    fn encoders_listing() {
        let t = " V....D libopenh264          OpenH264\n V....D h264_mf              H264 via MediaFoundation (codec h264)\n V..... h264_qsv  x\n A....D aac   AAC\nEncoders:\n ------\n";
        let n = listed_names(t);
        assert!(n.contains(&"h264_mf".to_string()) && n.contains(&"h264_qsv".to_string()) && n.contains(&"aac".to_string()));
        assert!(!n.iter().any(|x| x == "------" || x == "Encoders:"));
        // ffmpeg 9 usa 2 columnas de banderas («.S»); versiones anteriores, 3 («T.C»)
        let f = " .. zscale            V->V       Apply resizing\n .S tonemap  V->V x\n T.C overlay VV->V\n";
        let n = listed_names(f);
        assert!(n.contains(&"zscale".to_string()) && n.contains(&"tonemap".to_string()));
    }

    #[test]
    fn user_dir_must_match_manifest() {
        let d = std::env::temp_dir().join(format!("chamva-userdir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(format!("ffmpeg{EXE}")), b"falso").unwrap();
        std::fs::write(d.join(format!("ffprobe{EXE}")), b"falso").unwrap();
        // binarios falsos: nunca se aceptan desde la carpeta del usuario
        let r = locate(&[(d.clone(), Origin::User)]);
        assert!(r.is_err());
        assert!(verify_user_dir(&d).is_err());
        std::fs::write(d.join("version.dll"), b"plantada").unwrap();
        let e = verify_user_dir(&d).unwrap_err();
        assert!(e.contains("version.dll") || user_manifest().is_empty(), "{e}");
    }

    #[test]
    fn manifest_is_consistent() {
        let m = manifest();
        assert!(m.version.starts_with('n'));
        for (triple, t) in &m.targets {
            assert!(t.url.starts_with("https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-"), "{triple}");
            assert!(t.url.contains("lgpl") && !t.url.contains("-gpl"), "{triple}: solo builds LGPL");
            assert!(super::super::validate::is_cache_key(&t.sha256), "{triple}: sha256");
            if t.verified {
                let f = t.files.as_ref().expect("un build verificado fija los hashes de cada archivo");
                assert!(f.contains_key(&format!("ffmpeg{EXE}")) || triple.contains("windows"));
                assert!(f.values().all(|h| super::super::validate::is_cache_key(h)));
            }
        }
        #[cfg(all(windows, target_arch = "x86_64"))]
        assert_eq!(user_manifest().len(), 9);
    }

    #[test]
    fn missing_everywhere() {
        let d = std::env::temp_dir().join("chamva-nada-aqui-xyz");
        assert!(locate(&[(d, Origin::Bundled)]).is_err());
    }
}
