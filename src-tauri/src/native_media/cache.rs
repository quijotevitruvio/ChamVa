//! Caché de proxies y audio extraído en `<caché de la app>/native-media/`.
//!
//! Clave = SHA-256 de: versión del esquema, versión de ffmpeg, perfil de
//! conversión resuelto, ruta canónica, tamaño, fecha de modificación y el
//! contenido de 3 ventanas de 1 MiB (inicio, mitad, final). No se lee el
//! archivo entero (un ProRes de 50 GB tardaría minutos) pero cualquier cambio
//! de tamaño, fecha, cabecera (moov/ftyp), cola o perfil cambia la clave.
//! Los nombres en disco son `<clave>.<ext>` y la interfaz solo puede pedir
//! claves de 64 hex (ver `validate::is_cache_key`).

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::locate::hex;

pub const SCHEMA: &str = "chamva-native-media-v1";
const WINDOW: u64 = 1 << 20;
/// Tope total de la caché de proxies: al pasarlo se borran los más antiguos.
pub const MAX_CACHE_BYTES: u64 = 20 * 1024 * 1024 * 1024;

pub struct Dirs {
    pub out: PathBuf,
    pub tmp: PathBuf,
}

impl Dirs {
    pub fn new(cache_dir: &Path) -> std::io::Result<Self> {
        let root = cache_dir.join("native-media");
        let d = Dirs { out: root.join("out"), tmp: root.join("tmp") };
        std::fs::create_dir_all(&d.out)?;
        std::fs::create_dir_all(&d.tmp)?;
        Ok(d)
    }
    /// Borra los temporales de ejecuciones anteriores (cierre brusco, cancelaciones).
    pub fn clean_tmp(&self) {
        if let Ok(rd) = std::fs::read_dir(&self.tmp) {
            for e in rd.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

pub fn key_for(src: &Path, profile: &str, ffmpeg_version: &str) -> std::io::Result<String> {
    let meta = std::fs::metadata(src)?;
    let len = meta.len();
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    let mut h = Sha256::new();
    for part in [SCHEMA, ffmpeg_version, profile, &src.to_string_lossy()] {
        h.update((part.len() as u64).to_le_bytes());
        h.update(part.as_bytes());
    }
    h.update(len.to_le_bytes());
    h.update(mtime.to_le_bytes());
    let mut f = File::open(src)?;
    let mut buf = vec![0u8; WINDOW as usize];
    let mid = (len / 2).saturating_sub(WINDOW / 2);
    for off in [0, mid, len.saturating_sub(WINDOW)] {
        f.seek(SeekFrom::Start(off))?;
        let mut got = 0;
        while got < buf.len() {
            let n = f.read(&mut buf[got..])?;
            if n == 0 {
                break;
            }
            got += n;
        }
        h.update((got as u64).to_le_bytes());
        h.update(&buf[..got]);
    }
    Ok(hex(&h.finalize()))
}

/// Borra los más antiguos (por fecha de modificación) hasta quedar bajo `max`.
pub fn evict(dir: &Path, max: u64, keep: &Path) -> u64 {
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let m = e.metadata().ok()?;
                    m.is_file().then(|| (m.modified().unwrap_or(UNIX_EPOCH), m.len(), e.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    files.sort_by_key(|f| f.0);
    let mut freed = 0;
    for (_, len, p) in files {
        if total <= max {
            break;
        }
        if p == keep {
            continue;
        }
        if std::fs::remove_file(&p).is_ok() {
            total -= len;
            freed += len;
        }
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chamva-cache-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn key_is_stable_and_sensitive() {
        let d = tmp("key");
        let f = d.join("a.mp4");
        let data: Vec<u8> = (0..3_500_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&f, &data).unwrap();
        let k1 = key_for(&f, "h264_mf/720", "n9").unwrap();
        assert_eq!(k1.len(), 64);
        assert!(super::super::validate::is_cache_key(&k1));
        assert_eq!(k1, key_for(&f, "h264_mf/720", "n9").unwrap());
        assert_ne!(k1, key_for(&f, "h264_mf/1080", "n9").unwrap());
        assert_ne!(k1, key_for(&f, "h264_mf/720", "n10").unwrap());
        // cambiar un byte del centro (sin cambiar tamaño) cambia la clave
        let mut d2 = data.clone();
        d2[1_750_000] ^= 0xff;
        std::fs::write(&f, &d2).unwrap();
        assert_ne!(k1, key_for(&f, "h264_mf/720", "n9").unwrap());
        // archivo diminuto
        let s = d.join("s.mp4");
        std::fs::write(&s, b"abc").unwrap();
        assert_eq!(key_for(&s, "p", "v").unwrap().len(), 64);
    }

    #[test]
    fn eviction_keeps_newest_and_current() {
        let d = tmp("evict");
        for (i, n) in ["1.mp4", "2.mp4", "3.mp4"].iter().enumerate() {
            std::fs::write(d.join(n), vec![0u8; 1000]).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20 + i as u64));
        }
        let freed = evict(&d, 1500, &d.join("1.mp4"));
        assert_eq!(freed, 2000);
        let left: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().collect();
        assert_eq!(left.len(), 1);
        assert!(d.join("1.mp4").exists());
    }

    #[test]
    fn clean_tmp_removes_leftovers() {
        let d = tmp("dirs");
        let dirs = Dirs::new(&d).unwrap();
        std::fs::write(dirs.tmp.join("job-1.part"), b"x").unwrap();
        dirs.clean_tmp();
        assert_eq!(std::fs::read_dir(&dirs.tmp).unwrap().count(), 0);
        assert!(dirs.out.is_dir());
    }
}
