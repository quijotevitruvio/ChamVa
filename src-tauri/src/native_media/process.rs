//! Lanzar ffmpeg/ffprobe de forma acotada: sin shell (argv directo), entorno
//! vacío salvo una lista blanca (FFREPORT, AV_LOG_FORCE_*… no pueden cambiar el
//! comportamiento ni escribir archivos), stdin cerrado, directorio de trabajo
//! propio, sin ventana de consola en Windows, tiempo límite y tope de salida.

use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const ENV_ALLOW: &[&str] = &["SystemRoot", "windir", "SYSTEMDRIVE", "TEMP", "TMP", "LANG", "LC_ALL"];

pub fn command(bin: &Path, args: &[OsString], cwd: &Path) -> Command {
    let mut c = Command::new(bin);
    c.args(args).current_dir(cwd).env_clear().stdin(Stdio::null());
    for k in ENV_ALLOW {
        if let Some(v) = std::env::var_os(k) {
            c.env(k, v);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

pub struct Captured {
    pub ok: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
    pub overflow: bool,
}

/// Lee como mucho `cap` bytes; si hay más, marca `overflow` (el llamante mata el proceso).
fn reader<R: Read + Send + 'static>(mut r: R, cap: usize, overflow: Arc<AtomicBool>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let mut buf = [0u8; 16 * 1024];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out.len() + n > cap {
                        out.extend_from_slice(&buf[..cap - out.len()]);
                        overflow.store(true, Ordering::SeqCst);
                        break;
                    }
                    out.extend_from_slice(&buf[..n]);
                }
            }
        }
        out
    })
}

pub fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Ejecuta y captura con tiempo límite y topes de salida.
pub fn run_capture(mut cmd: Command, timeout: Duration, max_out: usize, max_err: usize) -> std::io::Result<Captured> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let overflow = Arc::new(AtomicBool::new(false));
    let so = reader(child.stdout.take().unwrap(), max_out, overflow.clone());
    let se = reader(child.stderr.take().unwrap(), max_err, Arc::new(AtomicBool::new(false)));
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break Some(st);
        }
        if overflow.load(Ordering::SeqCst) {
            kill(&mut child);
            break None;
        }
        if start.elapsed() > timeout {
            timed_out = true;
            kill(&mut child);
            break None;
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let stdout = so.join().unwrap_or_default();
    let stderr = se.join().unwrap_or_default();
    Ok(Captured {
        ok: status.map(|s| s.success()).unwrap_or(false),
        stdout,
        stderr,
        timed_out,
        overflow: overflow.load(Ordering::SeqCst),
    })
}

/// Últimas líneas útiles de stderr para mostrar un error (sin rutas largas).
pub fn tail_message(stderr: &[u8]) -> String {
    let s = String::from_utf8_lossy(stderr);
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(3)..].join(" · ");
    tail.chars().take(400).collect()
}
