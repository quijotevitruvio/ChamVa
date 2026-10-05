//! Construcción de argumentos de ffmpeg/ffprobe. TODO lo que ejecuta ffmpeg se
//! arma aquí, a partir de tipos cerrados (enums y números acotados): la
//! interfaz no puede añadir opciones, filtros ni rutas.
//!
//! Reglas comunes de entrada (`input_guard`):
//! - `-protocol_whitelist file`: solo el protocolo de archivo local (ni red,
//!   ni `concat:`, `subfile:`, `pipe:`, `data:`) para la entrada y para lo que
//!   un demuxer intente abrir desde dentro (referencias externas de MOV, etc.);
//! - `-format_whitelist`: solo demuxers de contenedores de video; quedan fuera
//!   HLS, DASH, concat/ffconcat, SDP, image2 con patrones, tty, lavfi…;
//! - la ruta va como `file:<canónica>` en UN argv.
//! Salidas: siempre rutas absolutas dentro del directorio temporal propio o
//! `pipe:1`; `-fs` limita el tamaño.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::Path;

/// Demuxers admitidos (nombres de `ffmpeg -formats`).
pub const FORMAT_WHITELIST: &str =
    "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts,mxf,flv,asf,mpeg,ogg,dv";

pub const MAX_PROXY_BYTES: u64 = 8 * 1024 * 1024 * 1024; // 8 GiB
pub const MAX_WAV_BYTES: u64 = 4_000_000_000; // límite RIFF

/// `file:<ruta>`. Con la ruta canónica (absoluta) nunca empieza por `-`.
pub fn input_arg(canon: &Path) -> OsString {
    let mut s = OsString::from("file:");
    s.push(canon.as_os_str());
    s
}

fn input_guard(v: &mut Vec<OsString>) {
    for a in ["-protocol_whitelist", "file", "-format_whitelist", FORMAT_WHITELIST] {
        v.push(a.into());
    }
}

fn base(v: &mut Vec<OsString>) {
    for a in ["-hide_banner", "-nostdin", "-loglevel", "error"] {
        v.push(a.into());
    }
}

fn push(v: &mut Vec<OsString>, xs: &[&str]) {
    for x in xs {
        v.push((*x).into());
    }
}

// ---------------------------------------------------------------- opciones

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum ProxyHeight {
    #[serde(rename = "360")]
    H360,
    #[serde(rename = "540")]
    H540,
    #[serde(rename = "720")]
    H720,
    #[serde(rename = "1080")]
    H1080,
}

impl ProxyHeight {
    pub fn px(self) -> u32 {
        match self {
            ProxyHeight::H360 => 360,
            ProxyHeight::H540 => 540,
            ProxyHeight::H720 => 720,
            ProxyHeight::H1080 => 1080,
        }
    }
    pub fn video_kbps(self) -> u32 {
        match self {
            ProxyHeight::H360 => 1200,
            ProxyHeight::H540 => 2500,
            ProxyHeight::H720 => 4500,
            ProxyHeight::H1080 => 9000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoChoice {
    Auto,
    H264,
    Vp8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProxyOptions {
    pub height: ProxyHeight,
    pub video: VideoChoice,
    /// convertir HDR (PQ/HLG) a SDR; si es false se deja la conversión simple
    pub tonemap: bool,
}

/// Lo que de verdad se ejecuta, ya resuelto (encoder concreto, fps, HDR).
#[derive(Debug, Clone, PartialEq)]
pub struct ProxyPlan {
    pub encoder: VideoEncoder,
    pub height: u32,
    pub kbps: u32,
    /// fps de salida como racional fijo de la lista `FPS_LIST`
    pub fps: (u32, u32),
    pub hdr: Option<HdrInput>,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoEncoder {
    H264Mf,
    H264VideoToolbox,
    Libvpx,
}

impl VideoEncoder {
    pub fn container(self) -> Container {
        match self {
            VideoEncoder::Libvpx => Container::Webm,
            _ => Container::Mp4,
        }
    }
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            VideoEncoder::H264Mf => "h264_mf",
            VideoEncoder::H264VideoToolbox => "h264_videotoolbox",
            VideoEncoder::Libvpx => "libvpx",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Container {
    Mp4,
    Webm,
}

impl Container {
    pub fn ext(self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Webm => "webm",
        }
    }
    pub fn mime(self) -> &'static str {
        match self {
            Container::Mp4 => "video/mp4",
            Container::Webm => "video/webm",
        }
    }
}

/// Parámetros de color HDR de entrada (valores cerrados, no texto libre).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HdrTransfer {
    Pq,
    Hlg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HdrInput {
    pub transfer: HdrTransfer,
    /// matriz bt2020 constante (bt2020c) o no constante (bt2020nc)
    pub constant_luminance: bool,
}

/// Fotogramas por segundo admitidos para el proxy (CFR).
pub const FPS_LIST: &[(u32, u32)] = &[
    (24000, 1001),
    (24, 1),
    (25, 1),
    (30000, 1001),
    (30, 1),
    (48, 1),
    (50, 1),
    (60000, 1001),
    (60, 1),
    (120, 1),
];

/// El fps de la lista más cercano al medido (0 o absurdo → 30).
pub fn snap_fps(measured: f64) -> (u32, u32) {
    if !measured.is_finite() || measured < 1.0 || measured > 1000.0 {
        return (30, 1);
    }
    let mut best = (30, 1);
    let mut err = f64::MAX;
    for &(n, d) in FPS_LIST {
        let e = (n as f64 / d as f64 - measured).abs();
        if e < err {
            err = e;
            best = (n, d);
        }
    }
    best
}

fn video_filter(plan: &ProxyPlan) -> String {
    let mut f = String::new();
    if let Some(h) = plan.hdr {
        let trc = match h.transfer {
            HdrTransfer::Pq => "smpte2084",
            HdrTransfer::Hlg => "arib-std-b67",
        };
        let mat = if h.constant_luminance { "bt2020c" } else { "bt2020nc" };
        // setparams fija las etiquetas (muchos archivos las traen incompletas) y
        // zscale+tonemap pasan a SDR bt709 (como ve el video un monitor normal)
        f.push_str(&format!(
            "setparams=color_trc={trc}:color_primaries=bt2020:colorspace={mat}:range=tv,\
             zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,\
             zscale=t=bt709:m=bt709:r=tv,"
        ));
    }
    // altura máxima (no se agranda), ancho par; la rotación de los móviles la
    // aplica ffmpeg antes (autorotate) y el proxy sale ya derecho
    f.push_str(&format!("scale=-2:'min({},ih)':flags=bicubic,", plan.height));
    f.push_str(match plan.encoder {
        VideoEncoder::H264Mf => "format=nv12",
        _ => "format=yuv420p",
    });
    f
}

/// Argumentos de la conversión a proxy. `out` es la ruta temporal propia.
pub fn proxy_args(src: &Path, out: &Path, plan: &ProxyPlan) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    input_guard(&mut v);
    v.push("-i".into());
    v.push(input_arg(src));
    push(&mut v, &["-map", "0:v:0"]);
    if plan.has_audio {
        push(&mut v, &["-map", "0:a:0"]);
    }
    push(&mut v, &["-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1"]);
    v.push("-vf".into());
    v.push(video_filter(plan).into());
    let (n, d) = plan.fps;
    let gop = ((n as f64 / d as f64).round() as u32).max(1).to_string();
    push(&mut v, &["-fps_mode", "cfr", "-r"]);
    v.push(format!("{n}/{d}").into());
    let kbps = format!("{}k", plan.kbps);
    push(&mut v, &["-c:v", plan.encoder.ffmpeg_name(), "-b:v", &kbps, "-g", &gop]);
    match plan.encoder {
        VideoEncoder::H264Mf => push(&mut v, &["-rate_control", "cbr", "-scenario", "archive"]),
        VideoEncoder::H264VideoToolbox => push(&mut v, &["-profile:v", "main", "-allow_sw", "1"]),
        VideoEncoder::Libvpx => push(&mut v, &["-deadline", "realtime", "-cpu-used", "8", "-auto-alt-ref", "0"]),
    }
    if plan.has_audio {
        match plan.encoder.container() {
            Container::Mp4 => push(&mut v, &["-c:a", "aac", "-b:a", "160k"]),
            Container::Webm => push(&mut v, &["-c:a", "libopus", "-b:a", "128k"]),
        }
        push(&mut v, &["-ac", "2", "-ar", "48000"]);
    }
    if plan.encoder.container() == Container::Mp4 {
        push(&mut v, &["-movflags", "+faststart"]);
    }
    push(&mut v, &["-f", plan.encoder.container().ext()]);
    let fs = MAX_PROXY_BYTES.to_string();
    push(&mut v, &["-fs", &fs, "-progress", "pipe:1", "-nostats", "-y"]);
    v.push(out.as_os_str().to_owned());
    v
}

/// Audio a WAV PCM 16 bits, 48 kHz, estéreo como máximo.
pub fn extract_audio_args(src: &Path, out: &Path) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    input_guard(&mut v);
    v.push("-i".into());
    v.push(input_arg(src));
    push(&mut v, &["-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1"]);
    push(&mut v, &["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-f", "wav"]);
    let fs = MAX_WAV_BYTES.to_string();
    push(&mut v, &["-fs", &fs, "-progress", "pipe:1", "-nostats", "-y"]);
    v.push(out.as_os_str().to_owned());
    v
}

pub fn probe_args(src: &Path) -> Vec<OsString> {
    let mut v = Vec::new();
    push(&mut v, &["-hide_banner", "-loglevel", "error"]);
    input_guard(&mut v);
    push(&mut v, &["-print_format", "json=compact=1", "-show_format", "-show_streams"]);
    v.push(input_arg(src));
    v
}

/// Opciones de lectura de fotogramas crudos (exportación desde el original).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameOptions {
    pub start: f64,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

impl FrameOptions {
    /// Límites: tamaño par 16..=7680×4320, fps 1..=120, tiempos finitos 0..=24 h.
    pub fn validate(&self) -> Result<(), &'static str> {
        let okt = |t: f64| t.is_finite() && (0.0..=86_400.0).contains(&t);
        if !okt(self.start) || !okt(self.duration) || self.duration <= 0.0 {
            return Err("tiempo fuera de rango");
        }
        if !(16..=7680).contains(&self.width) || !(16..=4320).contains(&self.height) {
            return Err("tamaño fuera de rango");
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err("el tamaño debe ser par");
        }
        if !self.fps.is_finite() || !(1.0..=120.0).contains(&self.fps) {
            return Err("fps fuera de rango");
        }
        Ok(())
    }
    pub fn frame_bytes(&self) -> usize {
        self.width as usize * self.height as usize * 4
    }
}

/// Fotogramas RGBA crudos por stdout, con el tiempo y tamaño pedidos.
pub fn frames_args(src: &Path, o: &FrameOptions) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    input_guard(&mut v);
    v.push("-ss".into());
    v.push(format!("{:.6}", o.start).into());
    v.push("-i".into());
    v.push(input_arg(src));
    v.push("-t".into());
    v.push(format!("{:.6}", o.duration).into());
    push(&mut v, &["-map", "0:v:0", "-an", "-sn", "-dn", "-vf"]);
    v.push(
        format!(
            "fps={:.6},scale={}:{}:flags=bicubic:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,format=rgba",
            o.fps, o.width, o.height, o.width, o.height
        )
        .into(),
    );
    push(&mut v, &["-f", "rawvideo", "pipe:1"]);
    v
}

// ------------------------------------------------- exportación por hardware

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum HwEncoder {
    H264Mf,
    H264Nvenc,
    H264Qsv,
    H264Amf,
    H264Videotoolbox,
}

impl HwEncoder {
    pub const ALL: [HwEncoder; 5] = [
        HwEncoder::H264Mf,
        HwEncoder::H264Nvenc,
        HwEncoder::H264Qsv,
        HwEncoder::H264Amf,
        HwEncoder::H264Videotoolbox,
    ];
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            HwEncoder::H264Mf => "h264_mf",
            HwEncoder::H264Nvenc => "h264_nvenc",
            HwEncoder::H264Qsv => "h264_qsv",
            HwEncoder::H264Amf => "h264_amf",
            HwEncoder::H264Videotoolbox => "h264_videotoolbox",
        }
    }
    #[cfg(test)]
    pub fn from_ffmpeg_name(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|e| e.ffmpeg_name() == s)
    }
    fn pix_fmt(self) -> &'static str {
        match self {
            HwEncoder::H264Mf | HwEncoder::H264Qsv => "nv12",
            _ => "yuv420p",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HwExportOptions {
    pub encoder: HwEncoder,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub kbps: u32,
}

impl HwExportOptions {
    pub fn validate(&self) -> Result<(), &'static str> {
        FrameOptions { start: 0.0, duration: 1.0, width: self.width, height: self.height, fps: self.fps }.validate()?;
        if !(200..=200_000).contains(&self.kbps) {
            return Err("tasa de bits fuera de rango");
        }
        Ok(())
    }
}

/// Prueba corta de que un encoder funciona en ESTA máquina (listado ≠ disponible).
pub fn hw_test_args(e: HwEncoder) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    push(&mut v, &["-f", "lavfi", "-i", "color=c=black:s=256x256:r=30:d=0.2"]);
    push(&mut v, &["-frames:v", "3", "-pix_fmt", e.pix_fmt(), "-c:v", e.ffmpeg_name(), "-f", "null", "-"]);
    v
}

/// Video RGBA por stdin → H.264 por hardware en MP4 temporal (sin audio).
pub fn hw_export_args(o: &HwExportOptions, out: &Path) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    push(&mut v, &["-f", "rawvideo", "-pix_fmt", "rgba", "-s"]);
    v.push(format!("{}x{}", o.width, o.height).into());
    v.push("-r".into());
    v.push(format!("{:.6}", o.fps).into());
    push(&mut v, &["-i", "pipe:0", "-pix_fmt", o.encoder.pix_fmt(), "-c:v", o.encoder.ffmpeg_name(), "-b:v"]);
    v.push(format!("{}k", o.kbps).into());
    let fs = MAX_PROXY_BYTES.to_string();
    push(&mut v, &["-movflags", "+faststart", "-f", "mp4", "-fs", &fs, "-progress", "pipe:1", "-nostats", "-y"]);
    v.push(out.as_os_str().to_owned());
    v
}

/// Une el video temporal y un WAV temporal (ambos propios) en el MP4 final temporal.
pub fn mux_audio_args(video: &Path, wav: &Path, out: &Path) -> Vec<OsString> {
    let mut v = Vec::new();
    base(&mut v);
    // archivos propios (temporales de la app): se fija el demuxer exacto
    for (p, fmt) in [(video, "mov,mp4,m4a,3gp,3g2,mj2"), (wav, "wav")] {
        push(&mut v, &["-protocol_whitelist", "file", "-format_whitelist", fmt]);
        v.push("-i".into());
        v.push(input_arg(p));
    }
    push(&mut v, &["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    push(&mut v, &["-movflags", "+faststart", "-f", "mp4", "-y"]);
    v.push(out.as_os_str().to_owned());
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn plan() -> ProxyPlan {
        ProxyPlan { encoder: VideoEncoder::H264Mf, height: 720, kbps: 4500, fps: (30, 1), hdr: None, has_audio: true }
    }

    fn strs(v: &[OsString]) -> Vec<String> {
        v.iter().map(|s| s.to_string_lossy().into_owned()).collect()
    }

    fn hostile() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"\\?\C:\v\-i evil; rm -rf $(x) & 'q'.mp4")
        } else {
            PathBuf::from("/v/-i evil; rm -rf $(x) & 'q'.mp4")
        }
    }

    #[test]
    fn hostile_path_is_single_file_argument() {
        let src = hostile();
        let out = PathBuf::from(if cfg!(windows) { r"C:\cache\tmp\job-1.mp4" } else { "/cache/tmp/job-1.mp4" });
        for args in [proxy_args(&src, &out, &plan()), extract_audio_args(&src, &out), probe_args(&src)] {
            let a = strs(&args);
            let i = a.iter().position(|x| x.contains("evil")).unwrap();
            assert!(a[i].starts_with("file:"), "{}", a[i]);
            assert_eq!(a.iter().filter(|x| x.contains("evil")).count(), 1);
            // el guardado de entrada va antes del archivo
            let pw = a.iter().position(|x| x == "-protocol_whitelist").unwrap();
            assert!(pw < i);
            assert_eq!(a[pw + 1], "file");
            let fw = a.iter().position(|x| x == "-format_whitelist").unwrap();
            assert!(fw < i);
            assert!(!a[fw + 1].contains("hls") && !a[fw + 1].contains("concat"));
        }
    }

    #[test]
    fn no_argument_starts_with_dash_except_known_flags() {
        let a = strs(&proxy_args(&hostile(), Path::new("/tmp/o.mp4"), &plan()));
        let known = [
            "-hide_banner", "-nostdin", "-loglevel", "-protocol_whitelist", "-format_whitelist", "-i", "-map", "-sn", "-dn",
            "-map_metadata", "-map_chapters", "-1", "-vf", "-fps_mode", "-r", "-c:v", "-b:v", "-g", "-rate_control",
            "-scenario", "-c:a", "-b:a", "-ac", "-ar", "-movflags", "-f", "-fs", "-progress", "-nostats", "-y",
        ];
        for x in a.iter().filter(|x| x.starts_with('-')) {
            assert!(known.contains(&x.as_str()), "argumento inesperado {x}");
        }
        assert_eq!(a.last().unwrap(), "/tmp/o.mp4");
    }

    #[test]
    fn proxy_plan_variants() {
        let mut p = plan();
        let a = strs(&proxy_args(Path::new("/s.mov"), Path::new("/o"), &p)).join(" ");
        assert!(a.contains("-c:v h264_mf") && a.contains("-c:a aac") && a.contains("+faststart") && a.contains("-f mp4"));
        assert!(a.contains("min(720,ih)") && a.contains("format=nv12") && !a.contains("tonemap"));
        p.encoder = VideoEncoder::Libvpx;
        p.has_audio = false;
        p.hdr = Some(HdrInput { transfer: HdrTransfer::Hlg, constant_luminance: false });
        let a = strs(&proxy_args(Path::new("/s.mov"), Path::new("/o"), &p)).join(" ");
        assert!(a.contains("-c:v libvpx") && a.contains("-f webm") && !a.contains("-c:a") && !a.contains("0:a:0"));
        assert!(a.contains("arib-std-b67") && a.contains("tonemap=hable") && a.contains("bt2020nc"));
    }

    #[test]
    fn fps_snapping() {
        assert_eq!(snap_fps(29.97), (30000, 1001));
        assert_eq!(snap_fps(30.0), (30, 1));
        assert_eq!(snap_fps(23.98), (24000, 1001));
        assert_eq!(snap_fps(59.94), (60000, 1001));
        assert_eq!(snap_fps(240.0), (120, 1));
        assert_eq!(snap_fps(0.0), (30, 1));
        assert_eq!(snap_fps(f64::NAN), (30, 1));
        assert_eq!(snap_fps(1e9), (30, 1));
    }

    #[test]
    fn frame_options_limits() {
        let ok = FrameOptions { start: 0.0, duration: 2.0, width: 1920, height: 1080, fps: 30.0 };
        assert!(ok.validate().is_ok());
        assert_eq!(ok.frame_bytes(), 1920 * 1080 * 4);
        for bad in [
            FrameOptions { width: 1921, ..ok },
            FrameOptions { width: 8, ..ok },
            FrameOptions { height: 9000, ..ok },
            FrameOptions { fps: 0.5, ..ok },
            FrameOptions { fps: f64::INFINITY, ..ok },
            FrameOptions { start: -1.0, ..ok },
            FrameOptions { start: f64::NAN, ..ok },
            FrameOptions { duration: 0.0, ..ok },
            FrameOptions { duration: 1e9, ..ok },
        ] {
            assert!(bad.validate().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn options_reject_unknown_values() {
        assert!(serde_json::from_str::<ProxyOptions>(r#"{"height":"720","video":"auto","tonemap":true}"#).is_ok());
        for bad in [
            r#"{"height":"719","video":"auto","tonemap":true}"#,
            r#"{"height":"720","video":"libx264","tonemap":true}"#,
            r#"{"height":"720","video":"auto","tonemap":true,"extra":"-vf"}"#,
            r#"{"height":"720","video":"auto"}"#,
        ] {
            assert!(serde_json::from_str::<ProxyOptions>(bad).is_err(), "{bad}");
        }
        assert!(serde_json::from_str::<HwExportOptions>(r#"{"encoder":"libx264","width":64,"height":64,"fps":30,"kbps":1000}"#).is_err());
        let hw: HwExportOptions = serde_json::from_str(r#"{"encoder":"h264_nvenc","width":64,"height":64,"fps":30,"kbps":1000}"#).unwrap();
        assert!(hw.validate().is_ok());
        assert!(HwExportOptions { kbps: 10, ..hw }.validate().is_err());
    }

    #[test]
    fn hw_names_roundtrip() {
        for e in HwEncoder::ALL {
            assert_eq!(HwEncoder::from_ffmpeg_name(e.ffmpeg_name()), Some(e));
        }
        assert_eq!(HwEncoder::from_ffmpeg_name("libx264"), None);
    }
}
