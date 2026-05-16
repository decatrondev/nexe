use tauri::Manager;

mod installer;
mod updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Handle --uninstall flag (called from Add/Remove Programs)
    #[cfg(target_os = "windows")]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.iter().any(|a| a == "--uninstall") {
            installer::run_uninstall();
            return;
        }
    }

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
            installer::check_install_status,
            installer::self_install,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Apply staged update before any window shows.
            // If applied, restart so the NEW binary runs.
            if updater::apply_staged_update(app.handle()) {
                updater::cleanup_old_files();
                let exe = std::env::current_exe().expect("get exe path");
                let _ = std::process::Command::new(exe).spawn();
                std::process::exit(0);
            }

            updater::cleanup_old_files();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
