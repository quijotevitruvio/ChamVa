// Comandos nativos de ChamVa.

#[cfg(desktop)]
mod native_media;

/// Si la app se abrió con doble clic sobre un .chamva (Windows pasa la ruta
/// como primer argumento), devuelve (nombre, contenido) para que el frontend
/// cargue el proyecto al iniciar.
#[tauri::command]
fn opened_file() -> Option<(String, String)> {
    let arg = std::env::args().nth(1)?;
    let path = std::path::PathBuf::from(&arg);
    if !path.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().to_string();
    let content = std::fs::read_to_string(&path).ok()?;
    Some((name, content))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // Auto-actualizador y reinicio: solo escritorio (en móvil actualiza la tienda/APK).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // V10: ffmpeg nativo, solo escritorio (v0.9.0: no incluido). Ver docs/seguridad-ffmpeg.md.
    #[cfg(desktop)]
    let builder = builder
        .manage(native_media::NativeMedia::default())
        .setup(|app| {
            use tauri::Manager;
            // temporales de una sesión anterior (cierre brusco, cancelaciones)
            if let Ok(c) = app.path().app_cache_dir() {
                if let Ok(d) = native_media::cache::Dirs::new(&c) {
                    d.clean_tmp();
                }
            }
            // copia propia de FFmpeg: comprobación barata (sello) en cada arranque y,
            // si falta o difiere, reparación desde los recursos del instalador. En un
            // hilo aparte: el arranque no espera aunque haya que copiar 150 MB.
            let h = app.handle().clone();
            std::thread::spawn(move || {
                h.state::<native_media::NativeMedia>().resolve_install(&h, false);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager;
            // las rutas soltadas las da el sistema operativo: se anotan aquí y la
            // interfaz solo puede pedir «registra lo último que se soltó»
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<native_media::NativeMedia>().note_dropped(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            opened_file,
            native_media::native_media_status,
            native_media::native_media_pick,
            native_media::native_media_take_dropped,
            native_media::native_media_probe,
            native_media::native_media_proxy,
            native_media::native_media_extract_audio,
            native_media::native_media_cancel,
            native_media::native_media_read,
            native_media::native_media_cache_clear,
            native_media::native_media_hw_encoders,
            native_media::native_media_frames_open,
            native_media::native_media_frames_read,
            native_media::native_media_frames_close,
            native_media::native_media_hw_export_open,
            native_media::native_media_hw_export_write,
            native_media::native_media_hw_export_write_audio,
            native_media::native_media_hw_export_finish,
            native_media::native_media_hw_export_abort,
        ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![opened_file]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    app.run(|_handle, _event| {
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = _event {
            use tauri::Manager;
            _handle.state::<native_media::NativeMedia>().shutdown(_handle);
        }
    });
}
