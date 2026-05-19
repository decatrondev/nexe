use tauri::{
    Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    image::Image,
};
use tauri_plugin_autostart::ManagerExt;

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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
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

            // Enable autostart by default (like Discord)
            {
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(true) {
                    let _ = autostart.enable();
                }
            }

            // System tray
            let show = MenuItemBuilder::with_id("show", "Open Nexe").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Nexe").build(app)?;
            let menu = MenuBuilder::new(app).item(&show).separator().item(&quit).build()?;

            let icon = Image::from_path("icons/32x32.png")
                .or_else(|_| Image::from_path("icons/icon.ico"))
                .unwrap_or_else(|_| Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("fallback icon"));

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Nexe")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
