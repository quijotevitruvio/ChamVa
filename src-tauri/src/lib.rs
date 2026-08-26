// Comandos nativos de ChamVa.

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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![opened_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
