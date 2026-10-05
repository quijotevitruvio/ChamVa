//! Dónde está ffmpeg y si se puede usar.
//!
//! Solo se ejecuta un binario en estas rutas FIJAS (nunca el PATH, nunca una
//! ruta que diga la interfaz), por orden:
//! 1. `<datos locales de la app>/ffmpeg/` con sello válido — la copia propia que
//!    `install.rs` coloca desde los recursos del instalador (comprobación barata:
//!    sello + tamaños + fechas, sin archivos de más);
//! 2. `<recursos de la app>/ffmpeg/` — lo que dejó el instalador, SOLO si cada
//!    archivo coincide con el SHA-256 del manifiesto (si la copia propia no se
//!    pudo hacer: disco lleno, otra ventana usando la carpeta…);
//! 3. `<datos locales de la app>/ffmpeg/` sin sello — instalado a mano por el
//!    usuario; SOLO si cada archivo coincide con los SHA-256 fijados y no hay
//!    archivos extra (evita DLL plantadas junto a ffmpeg.exe);
//! 4. en compilaciones de desarrollo, `src-tauri/binaries/ffmpeg/`.
//! Y en todos los casos el binario debe declararse LGPL (`-L`) y su
//! configuración (`-buildconf`) no puede llevar `--enable-gpl` ni `--enable-nonfree`
//! (condición necesaria, NO suficiente: `-L` no ve las licencias de las
//! bibliotecas externas; ver «Auditoría de licencias» en docs/seguridad-ffmpeg.md).
//!
//! Bloqueo: si el manifiesto (o la entrada de la plataforma) tiene `status`
//! distinto de `"ok"`, ningún candidato 1–3 se acepta, y un binario cuyo SHA-256
//! figure en una entrada bloqueada no se ejecuta NUNCA, ni siquiera en desarrollo.
//! v0.9.0: el build BtbN fijado está bloqueado → «nativo no disponible».

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

/// Mensaje al usuario cuando esta versión no trae un FFmpeg utilizable.
pub const NOT_INCLUDED: &str = "La conversión con FFmpeg nativo no está incluida en esta versión; llegará en una próxima actualización";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTarget {
    pub url: String,
    /// copias propias del mismo zip (Release del repo de ChamVa); mismo SHA-256
    /// (los usa `scripts/fetch-ffmpeg.mjs`; aquí solo se validan en las pruebas)
    #[serde(default)]
    #[allow(dead_code)]
    pub mirrors: Vec<String>,
    pub sha256: String,
    #[serde(default)]
    pub verified: bool,
    pub files: Option<BTreeMap<String, String>>,
    /// `None`/`"ok"`: utilizable. Cualquier otro valor (`"blocked-license"`…) la bloquea.
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub release: String,
    /// Release propio con el binario exacto y la fuente correspondiente
    #[serde(default)]
    pub source_release: String,
    pub ffmpeg_source: String,
    pub build_scripts: String,
    /// `None`/`"ok"`: utilizable. Cualquier otro valor bloquea TODO el build (falla cerrado).
    #[serde(default)]
    pub status: Option<String>,
    /// por qué está bloqueado (documentación; no se muestra)
    #[serde(default)]
    #[allow(dead_code)]
    pub blocked_reason: Option<String>,
    pub targets: BTreeMap<String, ManifestTarget>,
}

fn status_blocks(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|s| s != "ok")
}

impl Manifest {
    /// ¿El build entero está bloqueado (p. ej. por licencias)?
    pub fn is_blocked(&self) -> bool {
        status_blocks(&self.status)
    }

    /// Entrada utilizable para `triple`: `None` si no la hay o si está bloqueada.
    pub fn target(&self, triple: &str) -> Option<&ManifestTarget> {
        if self.is_blocked() {
            return None;
        }
        self.targets.get(triple).filter(|t| !status_blocks(&t.status))
    }

    /// SHA-256 de todo lo bloqueado (zip y cada archivo): un binario con uno de
    /// estos hashes NUNCA se ejecuta, esté donde esté (incluida la ruta de desarrollo).
    pub fn blocked_hashes(&self) -> Vec<&str> {
        let all = self.is_blocked();
        let mut v = Vec::new();
        for t in self.targets.values().filter(|t| all || status_blocks(&t.status)) {
            v.push(t.sha256.as_str());
            if let Some(f) = &t.files {
                v.extend(f.values().map(String::as_str));
            }
        }
        v
    }

    /// Archivos exactos (nombre, SHA-256) aceptados para `triple` (vacío si bloqueado o sin verificar).
    pub fn user_files(&self, triple: &str) -> Vec<(&str, &str)> {
        match self.target(triple) {
            Some(t) if t.verified => t.files.as_ref().map(|f| f.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()).unwrap_or_default(),
            _ => vec![],
        }
    }
}

pub fn manifest() -> &'static Manifest {
    static M: OnceLock<Manifest> = OnceLock::new();
    M.get_or_init(|| serde_json::from_str(MANIFEST_JSON).expect("ffmpeg-manifest.json no válido"))
}

pub const TRIPLE: &str = env!("CHAMVA_TARGET_TRIPLE");

/// Entrada utilizable del manifiesto para la plataforma para la que se compiló la app
/// (`None` si no la hay o si está bloqueada).
pub fn this_target() -> Option<&'static ManifestTarget> {
    manifest().target(TRIPLE)
}

/// Archivos exactos (nombre, SHA-256) que se aceptan en la carpeta del usuario:
/// solo si el build de esta plataforma está verificado, no bloqueado y tiene hashes fijados.
pub fn user_manifest() -> Vec<(&'static str, &'static str)> {
    manifest().user_files(TRIPLE)
}

/// Archivos que pueden acompañar a los binarios sin ejecutarse.
use super::install::EXTRA_OK as USER_EXTRA_OK;

/// Cómo se acepta un candidato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(debug_assertions), allow(dead_code))] // `None`/`Dev`: solo en desarrollo
pub enum Check {
    /// sello de `install.rs` (barato: no relee los binarios)
    Stamp,
    /// SHA-256 de cada archivo contra el manifiesto y sin archivos de más
    FullHash,
    /// solo compilaciones de desarrollo
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(not(debug_assertions), allow(dead_code))]
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
    /// Release propio con el binario exacto y su fuente (vacío si el build está bloqueado)
    pub source_release_url: String,
    /// false si esta versión de ChamVa no incluye un FFmpeg utilizable (build bloqueado)
    pub included: bool,
    /// resultado de «verificar y omitir / reparar» de la copia propia
    pub install: Option<super::install::Report>,
    /// texto de la licencia que acompaña al binario en uso (≤ 64 KiB)
    pub license_text: Option<String>,
}

impl NativeStatus {
    pub fn unavailable(reason: impl Into<String>, user_dir: Option<String>) -> Self {
        let m = manifest();
        // build bloqueado: ni URL, ni hash, ni carpeta para instalarlo a mano
        if m.is_blocked() {
            return NativeStatus {
                available: false,
                reason: Some(NOT_INCLUDED.into()),
                origin: None,
                version: None,
                license: None,
                listed_hw_encoders: vec![],
                has_libvpx: false,
                has_zscale: false,
                user_dir: None,
                pinned_source_url: None,
                pinned_sha256: None,
                pinned_version: String::new(),
                release_url: String::new(),
                ffmpeg_source_url: String::new(),
                build_scripts_url: String::new(),
                user_install_supported: false,
                source_release_url: String::new(),
                included: false,
                install: None,
                license_text: None,
            };
        }
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
            source_release_url: manifest().source_release.clone(),
            included: true,
            install: None,
            license_text: None,
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
#[cfg(test)]
pub fn verify_user_dir(dir: &Path) -> Result<(), String> {
    verify_dir_with(&user_manifest(), dir)
}

/// Igual que `verify_user_dir`, con la lista de archivos (nombre, SHA-256) explícita.
pub fn verify_dir_with(um: &[(&str, &str)], dir: &Path) -> Result<(), String> {
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
        // symlink_metadata: un enlace o una junta no cuentan como archivo normal
        let ft = std::fs::symlink_metadata(e.path()).map_err(|_| "no se puede leer la carpeta".to_string())?;
        if !ft.is_file() {
            return Err(format!("«{name}» no es un archivo normal"));
        }
    }
    for (name, want) in um {
        let got = sha256_file(&dir.join(name)).map_err(|_| format!("falta {name}"))?;
        if got != *want {
            return Err(format!("{name} no coincide con el SHA-256 publicado"));
        }
    }
    Ok(())
}

/// Candidatos en orden. `user_dir` es `<datos locales>/ffmpeg` (copia propia o manual).
pub fn candidates(resource_dir: Option<PathBuf>, user_dir: Option<PathBuf>) -> Vec<(PathBuf, Origin, Check)> {
    let mut v = Vec::new();
    if let Some(u) = &user_dir {
        v.push((u.clone(), Origin::Bundled, Check::Stamp));
    }
    if let Some(r) = resource_dir {
        v.push((r.join("ffmpeg"), Origin::Bundled, Check::FullHash));
    }
    if let Some(u) = user_dir {
        v.push((u, Origin::User, Check::FullHash));
    }
    #[cfg(debug_assertions)]
    v.push((PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg"), Origin::Dev, Check::None));
    v
}

pub fn locate(cands: &[(PathBuf, Origin, Check)]) -> Result<Located, String> {
    locate_in(manifest(), TRIPLE, cands)
}

/// ¿`ffmpeg`/`ffprobe` de `dir` son un binario bloqueado por el manifiesto?
/// Si no se pueden leer, se tratan como bloqueados (falla cerrado).
fn is_blocked_binary(m: &Manifest, ffmpeg: &Path, ffprobe: &Path) -> bool {
    let blocked = m.blocked_hashes();
    if blocked.is_empty() {
        return false;
    }
    [ffmpeg, ffprobe].iter().any(|p| match sha256_file(p) {
        Ok(h) => blocked.contains(&h.as_str()),
        Err(_) => true,
    })
}

/// `locate` con un manifiesto y una plataforma explícitos (pruebas).
pub fn locate_in(m: &Manifest, triple: &str, cands: &[(PathBuf, Origin, Check)]) -> Result<Located, String> {
    let blocked_build = m.is_blocked() || m.targets.get(triple).is_some_and(|t| status_blocks(&t.status));
    let mut last = if blocked_build { NOT_INCLUDED.to_string() } else { "FFmpeg no está instalado en esta copia de ChamVa".to_string() };
    for (dir, origin, check) in cands {
        let ffmpeg = dir.join(format!("ffmpeg{EXE}"));
        let ffprobe = dir.join(format!("ffprobe{EXE}"));
        if !(ffmpeg.is_file() && ffprobe.is_file()) {
            continue;
        }
        // build bloqueado: solo una compilación propia de desarrollo (no distribuida) podría usarse
        if blocked_build && *check != Check::None {
            continue;
        }
        // un binario bloqueado nunca se ejecuta, venga de donde venga
        if is_blocked_binary(m, &ffmpeg, &ffprobe) {
            last = NOT_INCLUDED.to_string();
            continue;
        }
        match check {
            Check::Stamp => {
                let Some(spec) = super::install::Spec::from_target(m, triple) else { continue };
                if super::install::check_stamp(dir, &spec).is_err() {
                    continue; // sin sello válido: puede ser una copia manual (candidato 3)
                }
            }
            Check::FullHash => {
                if let Err(e) = verify_dir_with(&m.user_files(triple), dir) {
                    last = match origin {
                        Origin::User => format!("La copia de FFmpeg de tu carpeta no es la verificada: {e}"),
                        _ => format!("El FFmpeg del instalador no es el verificado: {e}"),
                    };
                    continue;
                }
            }
            Check::None => {}
        }
        return Ok(Located { ffmpeg, ffprobe, origin: *origin });
    }
    Err(last)
}

/// `-L` y `-buildconf` de ffmpeg **y** ffprobe: ¿LGPL sin partes GPL/no libres?
pub fn license_check(ffmpeg: &Path, ffprobe: &Path, cwd: &Path) -> Result<String, String> {
    let l = run_text(ffmpeg, cwd, &["-hide_banner", "-L"])?;
    let bc = run_text(ffmpeg, cwd, &["-hide_banner", "-buildconf"])?;
    let license = license_ok(&l, &bc)?;
    let lp = run_text(ffprobe, cwd, &["-hide_banner", "-L"])?;
    let bcp = run_text(ffprobe, cwd, &["-hide_banner", "-buildconf"])?;
    license_ok(&lp, &bcp).map_err(|e| format!("ffprobe: {e}"))?;
    Ok(license)
}

/// Texto de la licencia que acompaña al binario (para mostrarlo en Ajustes).
pub fn license_text(dir: &Path) -> Option<String> {
    let p = dir.join(super::install::LICENSE);
    let m = std::fs::symlink_metadata(&p).ok()?;
    if !m.is_file() || m.len() > 64 * 1024 {
        return None;
    }
    std::fs::read_to_string(p).ok()
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
        let license = license_check(&loc.ffmpeg, &loc.ffprobe, cwd)?;
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
            license_text: loc.ffmpeg.parent().and_then(license_text),
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
        let r = locate(&[(d.clone(), Origin::User, Check::FullHash)]);
        // sin sello tampoco se acepta como copia propia
        assert!(locate(&[(d.clone(), Origin::Bundled, Check::Stamp)]).is_err());
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
        assert!(m.source_release.is_empty() || m.source_release.starts_with("https://github.com/quijotevitruvio/ChamVa/releases/tag/ffmpeg-"));
        for (triple, t) in &m.targets {
            assert!(t.url.starts_with("https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-"), "{triple}");
            for m in &t.mirrors {
                // solo el Release propio del repo y el mismo archivo (mismo SHA-256)
                assert!(m.starts_with("https://github.com/quijotevitruvio/ChamVa/releases/download/ffmpeg-"), "{triple}: {m}");
                assert_eq!(m.rsplit('/').next(), t.url.rsplit('/').next(), "{triple}");
            }
            assert!(t.url.contains("lgpl") && !t.url.contains("-gpl"), "{triple}: solo builds LGPL");
            assert!(super::super::validate::is_cache_key(&t.sha256), "{triple}: sha256");
            if t.verified {
                let f = t.files.as_ref().expect("un build verificado fija los hashes de cada archivo");
                assert!(f.contains_key(&format!("ffmpeg{EXE}")) || triple.contains("windows"));
                assert!(f.values().all(|h| super::super::validate::is_cache_key(h)));
            }
        }
        // v0.9.0: build BtbN bloqueado por licencias → nada utilizable ni instalable a mano
        assert!(m.is_blocked());
        assert!(this_target().is_none() && user_manifest().is_empty());
        assert!(m.blocked_hashes().contains(&"703a6b66a78b87ca86ae924d39746ad404bc749fd8b6a5a85a27240b4755e762"), "ffmpeg.exe BtbN bloqueado");
        let st = NativeStatus::unavailable("x", Some("C:/datos/ffmpeg".into()));
        assert!(!st.available && !st.included && !st.user_install_supported);
        assert!(st.user_dir.is_none() && st.pinned_source_url.is_none() && st.pinned_sha256.is_none());
        assert!(st.release_url.is_empty() && st.source_release_url.is_empty());
        assert_eq!(st.reason.as_deref(), Some(NOT_INCLUDED));
    }

    /// Binario con un hash bloqueado plantado en la carpeta de datos (con o sin sello
    /// falso) o en la ruta de desarrollo: NO se usa por ninguna vía.
    #[test]
    fn planted_blocked_binary_is_never_used() {
        let d = std::env::temp_dir().join(format!("chamva-planted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (ff, fp) = (b"ffmpeg-bloqueado".to_vec(), b"ffprobe-bloqueado".to_vec());
        std::fs::write(d.join(format!("ffmpeg{EXE}")), &ff).unwrap();
        std::fs::write(d.join(format!("ffprobe{EXE}")), &fp).unwrap();
        std::fs::write(d.join("LICENSE.txt"), "GNU LESSER GENERAL PUBLIC LICENSE").unwrap();
        std::fs::write(d.join(super::super::install::STAMP), r#"{"schema":1,"version":"n9.0.2","archiveSha256":"aa","files":{}}"#).unwrap();
        let h = |b: &[u8]| hex(&Sha256::digest(b));
        let mk = |top: &str| -> Manifest {
            let json = format!(
                r#"{{{top}"version":"n9.0.2","release":"r","ffmpegSource":"s","buildScripts":"b","targets":{{"{TRIPLE}":{{"url":"u","sha256":"{}","verified":true,"files":{{"ffmpeg{EXE}":"{}","ffprobe{EXE}":"{}"}}}}}}}}"#,
                "a".repeat(64),
                h(&ff),
                h(&fp)
            );
            serde_json::from_str(&json).unwrap()
        };
        let all = [(d.clone(), Origin::Bundled, Check::Stamp), (d.clone(), Origin::User, Check::FullHash), (d.clone(), Origin::Dev, Check::None)];
        let blocked = mk(r#""status":"blocked-license","#);
        let e = locate_in(&blocked, TRIPLE, &all).unwrap_err();
        assert!(e.contains("no está incluida en esta versión"), "{e}");
        // control: con el mismo manifiesto SIN bloquear, la copia manual exacta sí se aceptaría
        let open = mk("");
        let ok = locate_in(&open, TRIPLE, &[(d.clone(), Origin::User, Check::FullHash)]);
        assert!(ok.is_ok(), "{ok:?}");
        // y el manifiesto real de v0.9.0 tampoco la acepta
        assert!(locate(&all[..2]).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// En esta máquina de desarrollo puede estar el build BtbN real en `binaries/ffmpeg`
    /// (descargado antes de bloquearlo): `candidates` + `locate` no lo usan.
    #[test]
    fn real_blocked_dev_binary_is_not_used() {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg");
        let ff = dev.join(format!("ffmpeg{EXE}"));
        let Ok(h) = sha256_file(&ff) else { return };
        if !manifest().blocked_hashes().contains(&h.as_str()) {
            return; // otro binario de desarrollo (p. ej. un build propio)
        }
        let e = locate(&candidates(None, Some(dev.clone()))).unwrap_err();
        assert!(e.contains("no está incluida en esta versión"), "{e}");
    }

    #[test]
    fn missing_everywhere() {
        let d = std::env::temp_dir().join("chamva-nada-aqui-xyz");
        assert!(locate(&[(d.clone(), Origin::Bundled, Check::Stamp)]).is_err());
        assert!(locate(&[(d, Origin::Bundled, Check::FullHash)]).is_err());
    }
}
