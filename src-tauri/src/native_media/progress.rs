//! `-progress pipe:1`: bloques de líneas `clave=valor` que terminan en
//! `progress=continue|end`. Se leen con un tope de longitud por línea (una
//! salida maliciosa o rota no puede llenar la memoria) y solo se reenvían a la
//! interfaz las claves conocidas, con valores cortos y limpios.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{BufRead, ErrorKind};

pub const MAX_LINE: usize = 512;

pub const KEYS: &[&str] = &["frame", "fps", "out_time_us", "out_time_ms", "total_size", "speed", "progress", "drop_frames", "dup_frames"];

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProgressBlock {
    /// claves de `KEYS` con su valor (≤ 32 caracteres [0-9A-Za-z.:/_-])
    pub fields: BTreeMap<String, String>,
    pub end: bool,
}

/// Acumula líneas y devuelve un bloque al ver `progress=…`.
#[derive(Default)]
pub struct ProgressParser {
    cur: BTreeMap<String, String>,
}

impl ProgressParser {
    pub fn push_line(&mut self, line: &str) -> Option<ProgressBlock> {
        let line = line.trim_end_matches(['\r', '\n']);
        let (k, v) = line.split_once('=')?;
        let k = k.trim();
        if !KEYS.contains(&k) {
            return None;
        }
        let v: String = v
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '/' | '_' | '-'))
            .take(32)
            .collect();
        self.cur.insert(k.to_string(), v.clone());
        if k == "progress" {
            let fields = std::mem::take(&mut self.cur);
            return Some(ProgressBlock { fields, end: v == "end" });
        }
        None
    }
}

/// Microsegundos de salida de un bloque (`out_time_us`, o `out_time_ms`, que
/// pese al nombre también va en µs). `None` si es «N/A».
pub fn out_time_us(b: &ProgressBlock) -> Option<i64> {
    b.fields
        .get("out_time_us")
        .or_else(|| b.fields.get("out_time_ms"))
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| *v >= 0)
}

/// Lee una línea con tope: lo que pase de `MAX_LINE` se descarta hasta el
/// siguiente salto. Devuelve `Ok(None)` al final del flujo.
pub fn read_line_capped<R: BufRead>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<Option<String>> {
    buf.clear();
    loop {
        let chunk = match r.fill_buf() {
            Ok(c) => c,
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if chunk.is_empty() {
            return Ok(if buf.is_empty() { None } else { Some(String::from_utf8_lossy(buf).into_owned()) });
        }
        if let Some(i) = chunk.iter().position(|&b| b == b'\n') {
            let room = MAX_LINE.saturating_sub(buf.len());
            buf.extend_from_slice(&chunk[..i.min(room)]);
            r.consume(i + 1);
            return Ok(Some(String::from_utf8_lossy(buf).into_owned()));
        }
        let n = chunk.len();
        let room = MAX_LINE.saturating_sub(buf.len());
        buf.extend_from_slice(&chunk[..n.min(room)]);
        r.consume(n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn parses_blocks() {
        let text = "frame=10\nfps=0.00\nstream_0_0_q=-0.0\nbitrate=N/A\ntotal_size=1024\nout_time_us=333333\nout_time_ms=333333\nout_time=00:00:00.333333\nspeed=2.1x\nprogress=continue\nframe=120\nout_time_us=4000000\nspeed=9.27x\nprogress=end\n";
        let mut p = ProgressParser::default();
        let blocks: Vec<_> = text.lines().filter_map(|l| p.push_line(l)).collect();
        assert_eq!(blocks.len(), 2);
        assert!(!blocks[0].end && blocks[1].end);
        assert_eq!(out_time_us(&blocks[0]), Some(333333));
        assert_eq!(blocks[0].fields.get("speed").unwrap(), "2.1x");
        assert!(!blocks[0].fields.contains_key("bitrate") && !blocks[0].fields.contains_key("stream_0_0_q"));
        assert_eq!(out_time_us(&blocks[1]), Some(4_000_000));
    }

    #[test]
    fn na_and_hostile_values() {
        let mut p = ProgressParser::default();
        p.push_line("out_time_us=N/A");
        p.push_line("speed=<img src=x onerror=alert(1)>");
        let b = p.push_line("progress=continue").unwrap();
        assert_eq!(out_time_us(&b), None);
        assert_eq!(b.fields.get("speed").unwrap(), "imgsrcxonerroralert1");
        assert!(p.push_line("sin igual").is_none());
        let mut p = ProgressParser::default();
        p.push_line("out_time_us=-5");
        assert_eq!(out_time_us(&p.push_line("progress=end").unwrap()), None);
    }

    #[test]
    fn capped_reader() {
        let long = format!("{}\nfin\n", "x".repeat(10_000));
        let mut r = Cursor::new(long.into_bytes());
        let mut buf = Vec::new();
        let a = read_line_capped(&mut r, &mut buf).unwrap().unwrap();
        assert_eq!(a.len(), MAX_LINE);
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap().unwrap(), "fin");
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap(), None);
        let mut r = Cursor::new(b"sin salto".to_vec());
        assert_eq!(read_line_capped(&mut r, &mut buf).unwrap().unwrap(), "sin salto");
    }
}
