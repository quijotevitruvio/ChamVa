// Manifiesto de la app: con él, CADA comando propio necesita un permiso
// explícito en capabilities/ (los no listados quedan bloqueados por la ACL).
const COMMANDS: &[&str] = &[
    "opened_file",
    "native_media_status",
    "native_media_pick",
    "native_media_take_dropped",
    "native_media_probe",
    "native_media_proxy",
    "native_media_extract_audio",
    "native_media_cancel",
    "native_media_read",
    "native_media_cache_clear",
    "native_media_hw_encoders",
    "native_media_frames_open",
    "native_media_frames_read",
    "native_media_frames_close",
    "native_media_hw_export_open",
    "native_media_hw_export_write",
    "native_media_hw_export_write_audio",
    "native_media_hw_export_finish",
    "native_media_hw_export_abort",
];

fn main() {
    // triple de destino: elige la entrada de ffmpeg-manifest.json en locate.rs
    println!("cargo:rustc-env=CHAMVA_TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    println!("cargo:rerun-if-changed=ffmpeg-manifest.json");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri-build falló");
}
