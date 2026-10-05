//! ffprobe JSON → resumen tipado. A la interfaz solo llega este resumen (no el
//! JSON crudo ni etiquetas de metadatos, que podrían traer texto arbitrario).

use serde::Serialize;
use serde_json::Value;

use super::args::{HdrInput, HdrTransfer};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub codec: String,
    pub profile: Option<String>,
    pub pix_fmt: Option<String>,
    pub width: u32,
    pub height: u32,
    /// fps medio (avg_frame_rate)
    pub fps: f64,
    /// r_frame_rate y avg_frame_rate difieren: frecuencia variable
    pub variable_fps: bool,
    /// grados horarios (0/90/180/270)
    pub rotation: u32,
    pub bit_depth: u32,
    pub color_transfer: Option<String>,
    pub hdr: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub container: String,
    pub duration: f64,
    pub size: u64,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
    pub audio_streams: u32,
    #[serde(skip)]
    pub hdr_input: Option<HdrInput>,
}

/// Solo [a-z0-9_.-], ≤ 32: los nombres de códec/formato llegan limpios a la UI.
fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ','))
        .take(32)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn rate(v: Option<&Value>) -> f64 {
    let s = v.and_then(Value::as_str).unwrap_or("0/0");
    let mut it = s.split('/');
    let n: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let d: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(1.0);
    if d > 0.0 && n.is_finite() && (n / d).is_finite() {
        n / d
    } else {
        0.0
    }
}

fn num(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn rotation(st: &Value) -> u32 {
    let mut r = 0.0;
    if let Some(list) = st.get("side_data_list").and_then(Value::as_array) {
        for sd in list {
            if sd.get("rotation").is_some() {
                r = num(sd.get("rotation"));
            }
        }
    }
    if r == 0.0 {
        r = num(st.get("tags").and_then(|t| t.get("rotate")));
    }
    // ffprobe da la rotación antihoraria (-90 = 90° horario)
    let cw = ((-r).round() as i64).rem_euclid(360);
    match cw {
        80..=100 => 90,
        170..=190 => 180,
        260..=280 => 270,
        _ => 0,
    }
}

fn bit_depth(pix: &str, st: &Value) -> u32 {
    let b = num(st.get("bits_per_raw_sample")) as u32;
    if b > 0 && b <= 16 {
        return b;
    }
    if pix.contains("p16") {
        16
    } else if pix.contains("p12") {
        12
    } else if pix.contains("p10") || pix.contains("v210") || pix.contains("p010") || pix.contains("yuv422p10") {
        10
    } else {
        8
    }
}

pub fn parse_probe(json: &str, size: u64) -> Result<ProbeInfo, String> {
    let root: Value = serde_json::from_str(json).map_err(|_| "respuesta de ffprobe no válida".to_string())?;
    let streams = root.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let fmt = root.get("format").cloned().unwrap_or(Value::Null);
    let mut video = None;
    let mut audio = None;
    let mut hdr_input = None;
    let mut audio_streams = 0;
    for st in &streams {
        let ty = st.get("codec_type").and_then(Value::as_str).unwrap_or("");
        let attached = st.get("disposition").and_then(|d| d.get("attached_pic")).and_then(Value::as_i64) == Some(1);
        if ty == "video" && video.is_none() && !attached {
            let pix = clean(st.get("pix_fmt").and_then(Value::as_str).unwrap_or(""));
            let trc = st.get("color_transfer").and_then(Value::as_str).map(clean);
            let space = st.get("color_space").and_then(Value::as_str).map(clean);
            let transfer = match trc.as_deref() {
                Some("smpte2084") => Some(HdrTransfer::Pq),
                Some("arib-std-b67") => Some(HdrTransfer::Hlg),
                _ => None,
            };
            hdr_input = transfer.map(|t| HdrInput { transfer: t, constant_luminance: space.as_deref() == Some("bt2020c") });
            let avg = rate(st.get("avg_frame_rate"));
            let r = rate(st.get("r_frame_rate"));
            let fps = if avg > 0.0 { avg } else { r };
            video = Some(VideoInfo {
                codec: clean(st.get("codec_name").and_then(Value::as_str).unwrap_or("desconocido")),
                profile: st.get("profile").and_then(Value::as_str).map(clean),
                bit_depth: bit_depth(&pix, st),
                pix_fmt: if pix.is_empty() { None } else { Some(pix) },
                width: num(st.get("width")).clamp(0.0, 65535.0) as u32,
                height: num(st.get("height")).clamp(0.0, 65535.0) as u32,
                fps,
                variable_fps: avg > 0.0 && r > 0.0 && ((r - avg).abs() / r) > 0.02,
                rotation: rotation(st),
                hdr: match transfer {
                    Some(HdrTransfer::Pq) => Some("pq"),
                    Some(HdrTransfer::Hlg) => Some("hlg"),
                    None => None,
                },
                color_transfer: trc,
            });
        } else if ty == "audio" {
            audio_streams += 1;
            if audio.is_none() {
                audio = Some(AudioInfo {
                    codec: clean(st.get("codec_name").and_then(Value::as_str).unwrap_or("desconocido")),
                    channels: num(st.get("channels")).clamp(0.0, 64.0) as u32,
                    sample_rate: num(st.get("sample_rate")).clamp(0.0, 768_000.0) as u32,
                });
            }
        }
    }
    let mut duration = num(fmt.get("duration"));
    if !(duration.is_finite() && duration > 0.0) {
        duration = streams.iter().map(|s| num(s.get("duration"))).fold(0.0, f64::max);
    }
    if video.is_none() && audio.is_none() {
        return Err("el archivo no tiene pistas de video ni de audio".into());
    }
    Ok(ProbeInfo {
        container: clean(fmt.get("format_name").and_then(Value::as_str).unwrap_or("")),
        duration: if duration.is_finite() { duration.max(0.0) } else { 0.0 },
        size,
        video,
        audio,
        audio_streams,
        hdr_input,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iphone_hevc_hdr_rotated() {
        let j = r#"{"streams":[
          {"index":0,"codec_name":"hevc","profile":"Main 10","codec_type":"video","width":1920,"height":1080,
           "pix_fmt":"yuv420p10le","color_space":"bt2020nc","color_transfer":"arib-std-b67","color_primaries":"bt2020",
           "r_frame_rate":"30/1","avg_frame_rate":"28263/1043","side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]},
          {"index":1,"codec_name":"aac","codec_type":"audio","sample_rate":"44100","channels":2},
          {"index":2,"codec_name":"none","codec_type":"data"}],
          "format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"12.5"}}"#;
        let p = parse_probe(j, 1000).unwrap();
        let v = p.video.unwrap();
        assert_eq!(v.codec, "hevc");
        assert_eq!(v.rotation, 90);
        assert_eq!(v.bit_depth, 10);
        assert_eq!(v.hdr, Some("hlg"));
        assert!(v.variable_fps);
        assert_eq!(p.hdr_input, Some(HdrInput { transfer: HdrTransfer::Hlg, constant_luminance: false }));
        assert_eq!(p.audio.unwrap().sample_rate, 44100);
        assert_eq!(p.duration, 12.5);
    }

    #[test]
    fn prores_pcm_mov() {
        let j = r#"{"streams":[{"codec_name":"prores","profile":"HQ","codec_type":"video","width":3840,"height":2160,
          "pix_fmt":"yuv422p10le","r_frame_rate":"25/1","avg_frame_rate":"25/1","bits_per_raw_sample":"10"},
          {"codec_name":"pcm_s24le","codec_type":"audio","sample_rate":"48000","channels":6}],
          "format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"4.0"}}"#;
        let p = parse_probe(j, 5).unwrap();
        let v = p.video.unwrap();
        assert_eq!((v.codec.as_str(), v.fps, v.variable_fps, v.hdr, v.rotation), ("prores", 25.0, false, None, 0));
        assert_eq!(p.audio.unwrap().channels, 6);
        assert!(p.hdr_input.is_none());
    }

    #[test]
    fn hostile_strings_are_cleaned_and_bad_json_fails() {
        let j = r#"{"streams":[{"codec_name":"<script>alert(1)</script>","codec_type":"video","width":-5,"height":1e12,
          "r_frame_rate":"1/0","avg_frame_rate":"x"}],"format":{"format_name":"matroska,webm","duration":"NaN"}}"#;
        let p = parse_probe(j, 0).unwrap();
        let v = p.video.unwrap();
        assert_eq!(v.codec, "scriptalert1script");
        assert_eq!((v.width, v.height, v.fps), (0, 65535, 0.0));
        assert_eq!(p.duration, 0.0);
        assert!(parse_probe("no json", 0).is_err());
        assert!(parse_probe(r#"{"streams":[],"format":{}}"#, 0).is_err());
    }

    #[test]
    fn cover_art_is_not_the_video() {
        let j = r#"{"streams":[{"codec_name":"mjpeg","codec_type":"video","disposition":{"attached_pic":1}},
          {"codec_name":"mp3","codec_type":"audio","channels":2,"sample_rate":"44100"}],"format":{"duration":"3"}}"#;
        let p = parse_probe(j, 1).unwrap();
        assert!(p.video.is_none());
        assert_eq!(p.audio_streams, 1);
    }
}
