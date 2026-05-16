use tauri::Manager;

mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            updater::check_for_update,
            updater::download_update,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Apply staged update before any window shows
            updater::apply_staged_update(app.handle());
            updater::cleanup_old_files();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
