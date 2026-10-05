//! Validación de rutas de ENTRADA para ffmpeg/ffprobe.
//!
//! Superficie de ataque: la interfaz (webview) NUNCA envía rutas. Las rutas
//! llegan solo de dos sitios controlados por el sistema operativo: el diálogo
//! nativo «Abrir» (abierto desde Rust) y el evento nativo de soltar archivos.
//! Aun así, cada ruta pasa por `validate_source` antes de registrarse:
//!
//! - absoluta, sin componentes `..` ni `.` (se comprueba ANTES de resolver);
//! - sin NUL ni saltos de línea (ffmpeg los trataría como separadores en logs);
//! - nada de rutas de red/dispositivo en Windows (`\\servidor\…`, `\\?\UNC\…`,
//!   `\\.\…`): evitan cuelgues, fugas de credenciales NTLM y dispositivos;
//! - se canonicaliza (resuelve enlaces simbólicos/juntas) y se revalida el
//!   destino: debe ser un archivo regular, local y con extensión de video
//!   permitida (nada de `.m3u8`, `.txt`/ffconcat, `.sdp`…);
//! - tamaño > 0 y ≤ `MAX_SOURCE_BYTES`.
//!
//! El argumento que recibe ffmpeg se construye en `args.rs` como
//! `file:<ruta canónica absoluta>`: nunca empieza por `-` (no puede tomarse por
//! una opción), fuerza el protocolo `file` (un nombre como `concat:a|b` o
//! `http://…` no puede cambiar de protocolo) y se pasa como UN elemento de argv
//! sin shell (espacios, `;`, `&`, `$()`, comillas no se interpretan).

use std::ffi::OsStr;
use std::fmt;
use std::path::{Component, Path, PathBuf};

/// 256 GiB: más que cualquier clip razonable; evita tamaños absurdos.
pub const MAX_SOURCE_BYTES: u64 = 256 * 1024 * 1024 * 1024;

/// Extensiones de video que se aceptan como origen (en minúsculas).
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "qt", "mkv", "webm", "avi", "mts", "m2ts", "ts", "mxf", "3gp", "3g2", "wmv",
    "asf", "flv", "mpg", "mpeg", "ogv", "dv",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathError {
    NotAbsolute,
    Traversal,
    BadChars,
    Network,
    NotFound,
    NotAFile,
    BadExtension,
    Empty,
    TooBig,
}

impl fmt::Display for PathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PathError::NotAbsolute => "la ruta no es absoluta",
            PathError::Traversal => "la ruta contiene «..» o «.»",
            PathError::BadChars => "la ruta contiene caracteres de control",
            PathError::Network => "no se admiten rutas de red ni de dispositivo",
            PathError::NotFound => "el archivo no existe",
            PathError::NotAFile => "no es un archivo normal",
            PathError::BadExtension => "extensión de video no admitida",
            PathError::Empty => "el archivo está vacío",
            PathError::TooBig => "el archivo es demasiado grande",
        };
        f.write_str(s)
    }
}

/// Comprobaciones léxicas (sin tocar el disco). Públicas para los tests.
pub fn lexical_check(p: &Path) -> Result<(), PathError> {
    let s = p.as_os_str().to_string_lossy();
    if s.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return Err(PathError::BadChars);
    }
    if is_network_or_device(&s) {
        return Err(PathError::Network);
    }
    if !p.is_absolute() {
        return Err(PathError::NotAbsolute);
    }
    for c in p.components() {
        match c {
            Component::ParentDir | Component::CurDir => return Err(PathError::Traversal),
            _ => {}
        }
    }
    // `Path::components` normaliza «a/./b»; se mira también el texto crudo.
    let raw = s.replace('\\', "/");
    if raw.split('/').any(|seg| seg == ".." || seg == ".") {
        return Err(PathError::Traversal);
    }
    Ok(())
}

/// `\\servidor\recurso`, `//servidor/recurso`, `\\?\UNC\…`, `\\.\dispositivo`,
/// `\\?\GLOBALROOT…`. Se admite `\\?\C:\…` (lo devuelve `canonicalize` en Windows).
pub fn is_network_or_device(s: &str) -> bool {
    let n = s.replace('/', "\\");
    if let Some(rest) = n.strip_prefix("\\\\?\\") {
        // prefijo de ruta larga: solo vale si sigue una letra de unidad «C:\»
        let b = rest.as_bytes();
        return !(b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\');
    }
    n.starts_with("\\\\")
}

fn has_allowed_extension(p: &Path) -> bool {
    p.extension()
        .and_then(OsStr::to_str)
        .map(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Valida y canonicaliza una ruta de origen elegida por el usuario.
pub fn validate_source(p: &Path) -> Result<PathBuf, PathError> {
    lexical_check(p)?;
    if !has_allowed_extension(p) {
        return Err(PathError::BadExtension);
    }
    let canon = std::fs::canonicalize(p).map_err(|_| PathError::NotFound)?;
    // el destino real (tras resolver enlaces) se revalida entero
    lexical_check(&canon)?;
    if !has_allowed_extension(&canon) {
        return Err(PathError::BadExtension);
    }
    let meta = std::fs::metadata(&canon).map_err(|_| PathError::NotFound)?;
    if !meta.is_file() {
        return Err(PathError::NotAFile);
    }
    if meta.len() == 0 {
        return Err(PathError::Empty);
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err(PathError::TooBig);
    }
    Ok(canon)
}

/// Clave de caché/salida: exactamente 64 hex en minúsculas (sha-256). Lo que
/// llega de la interfaz para leer un proxy se valida con esto ANTES de formar
/// la ruta, así que no hay forma de salir del directorio de caché.
pub fn is_cache_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chamva-validate-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(&d).unwrap()
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"\0\0\0\x18ftypmp42").unwrap();
        p
    }

    #[test]
    fn hostile_names_are_ok_as_data() {
        // Nombres raros pero legítimos: se aceptan porque NUNCA pasan por un
        // shell; ffmpeg los recibe como un único argv `file:<ruta>`.
        let d = tmpdir("hostile");
        for n in [
            "a;b.mp4",
            "a & calc.mp4",
            "$(rm -rf).mp4",
            "`whoami`.mp4",
            "con espacios y 'comillas'.mov",
            "doble \"comilla\".mkv",
            "-i evil.mp4",
            "--help.mp4",
            "-y.mp4",
            "concat:x.mp4",
            "pipe:1.mp4",
            "100%.webm",
            "ñandú 🎬.mp4",
        ] {
            if cfg!(windows) && (n.contains('"')) {
                continue; // Windows no admite comillas dobles en nombres
            }
            let p = touch(&d, n);
            let c = validate_source(&p).unwrap_or_else(|e| panic!("{n}: {e}"));
            let arg = crate::native_media::args::input_arg(&c);
            let s = arg.to_string_lossy();
            assert!(s.starts_with("file:"), "{s}");
            assert!(!s.starts_with('-'));
        }
    }

    #[test]
    fn rejects_traversal_and_relative() {
        assert_eq!(lexical_check(Path::new("video.mp4")), Err(PathError::NotAbsolute));
        assert_eq!(lexical_check(Path::new("-i")), Err(PathError::NotAbsolute));
        assert_eq!(lexical_check(Path::new("./x.mp4")), Err(PathError::NotAbsolute));
        let d = tmpdir("trav");
        // como texto: en rutas \? `PathBuf::join("..")` ya lo resolvería
        let bad = PathBuf::from(format!("{}{}sub{}..{}x.mp4", d.display(), std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR));
        assert_eq!(lexical_check(&bad), Err(PathError::Traversal));
        let bad2 = PathBuf::from(format!("{}/./x.mp4", d.display()));
        assert_eq!(lexical_check(&bad2), Err(PathError::Traversal));
        assert_eq!(validate_source(&bad), Err(PathError::Traversal));
    }

    #[test]
    fn rejects_control_chars() {
        assert_eq!(lexical_check(Path::new("/tmp/a\nb.mp4")), Err(PathError::BadChars));
        assert_eq!(lexical_check(Path::new("/tmp/a\rb.mp4")), Err(PathError::BadChars));
    }

    #[test]
    fn rejects_unc_and_devices() {
        for s in [
            r"\\servidor\recurso\v.mp4",
            r"//servidor/recurso/v.mp4",
            r"\\?\UNC\servidor\recurso\v.mp4",
            r"\\.\PhysicalDrive0",
            r"\\.\pipe\x.mp4",
            r"\\?\GLOBALROOT\Device\x.mp4",
        ] {
            assert!(is_network_or_device(s), "{s}");
            assert_eq!(lexical_check(Path::new(s)), Err(PathError::Network), "{s}");
        }
        assert!(!is_network_or_device(r"\\?\C:\Users\x\v.mp4"));
        assert!(!is_network_or_device(r"C:\Users\x\v.mp4"));
        assert!(!is_network_or_device("/home/x/v.mp4"));
    }

    #[test]
    fn rejects_missing_dirs_and_bad_ext() {
        let d = tmpdir("missing");
        assert_eq!(validate_source(&d.join("no-existe.mp4")), Err(PathError::NotFound));
        let dir = d.join("carpeta.mp4");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(validate_source(&dir), Err(PathError::NotAFile));
        for n in ["lista.m3u8", "x.txt", "x.ffconcat", "x.sdp", "sin-extension", "x.exe", "x.mp4.lnk"] {
            let p = touch(&d, n);
            assert_eq!(validate_source(&p), Err(PathError::BadExtension), "{n}");
        }
        let empty = d.join("vacio.mp4");
        fs::write(&empty, b"").unwrap();
        assert_eq!(validate_source(&empty), Err(PathError::Empty));
    }

    #[test]
    fn symlinks_are_resolved_and_revalidated() {
        let d = tmpdir("link");
        let target = touch(&d, "real.mp4");
        let txt = touch(&d, "playlist.m3u8");
        let link_ok = d.join("enlace.mp4");
        let link_bad = d.join("disfrazado.mp4");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target, &link_ok).unwrap();
            std::os::unix::fs::symlink(&txt, &link_bad).unwrap();
        }
        #[cfg(windows)]
        {
            // crear enlaces simbólicos en Windows exige modo desarrollador o admin
            if std::os::windows::fs::symlink_file(&target, &link_ok).is_err()
                || std::os::windows::fs::symlink_file(&txt, &link_bad).is_err()
            {
                eprintln!("(sin permiso para crear enlaces simbólicos: se omite)");
                return;
            }
        }
        let c = validate_source(&link_ok).unwrap();
        assert_eq!(c, fs::canonicalize(&target).unwrap());
        // un .mp4 que en realidad apunta a una lista HLS se rechaza
        assert_eq!(validate_source(&link_bad), Err(PathError::BadExtension));
    }

    #[test]
    fn cache_keys() {
        assert!(is_cache_key(&"a".repeat(64)));
        assert!(!is_cache_key(&"A".repeat(64)));
        assert!(!is_cache_key("../../etc/passwd"));
        assert!(!is_cache_key(&format!("{}/", "a".repeat(63))));
        assert!(!is_cache_key(&"a".repeat(65)));
        assert!(!is_cache_key(""));
    }
}
