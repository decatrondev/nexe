use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

/// Check if the app is running from its installed location.
/// On Windows: installed = running from %LocalAppData%\Nexe\
/// On other platforms: always "installed" (they use native package managers).
#[tauri::command]
pub fn check_install_status() -> String {
    #[cfg(target_os = "windows")]
    {
        let exe = match std::env::current_exe() {
            Ok(e) => e,
            Err(_) => return "installed".into(),
        };
        let install_dir = match get_install_dir() {
            Some(d) => d,
            None => return "installed".into(),
        };
        if exe.starts_with(&install_dir) {
            "installed".into()
        } else {
            "needs_install".into()
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        "installed".into()
    }
}

/// Self-install: copy exe to AppData, create shortcuts, register in Add/Remove Programs.
/// Then launches the installed copy and signals the caller to exit.
#[tauri::command]
pub fn self_install(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let source_exe = std::env::current_exe()
            .map_err(|e| format!("Get exe: {}", e))?;

        let install_dir = get_install_dir()
            .ok_or("Cannot determine install directory")?;
        let installed_exe = install_dir.join("Nexe.exe");

        // Create install directory
        fs::create_dir_all(&install_dir)
            .map_err(|e| format!("Create install dir: {}", e))?;

        // Copy exe to install location
        fs::copy(&source_exe, &installed_exe)
            .map_err(|e| format!("Copy exe: {}", e))?;

        // Copy the entire app resources if running as a Tauri bundle
        // (the exe embeds everything, so just the exe is enough)

        let version = app.package_info().version.to_string();

        // Create shortcuts and register (all silent, no windows)
        create_shortcuts(&installed_exe)?;
        register_app(&install_dir, &installed_exe, &version)?;

        // Launch the installed copy
        let _ = std::process::Command::new(&installed_exe).spawn();

        // Exit this process
        std::process::exit(0);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Uninstall: remove app directory, shortcuts, registry entries.
/// Called via Nexe.exe --uninstall from Add/Remove Programs.
#[cfg(target_os = "windows")]
pub fn run_uninstall() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let install_dir = match get_install_dir() {
        Some(d) => d,
        None => return,
    };

    // Remove shortcuts
    if let Some(desktop) = dirs_desktop() {
        let _ = fs::remove_file(desktop.join("Nexe.lnk"));
    }
    if let Some(start_menu) = dirs_start_menu() {
        let _ = fs::remove_dir_all(start_menu.join("Nexe"));
    }

    // Remove registry entry
    let _ = std::process::Command::new("reg")
        .args(["delete", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexe", "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    // Schedule deletion of install directory (can't delete running exe)
    let dir_str = install_dir.to_string_lossy();
    let _ = std::process::Command::new("cmd")
        .args(["/C", &format!("timeout /t 2 /nobreak >nul & rmdir /s /q \"{}\"", dir_str)])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();

    std::process::exit(0);
}

// ── Windows helpers ──

#[cfg(target_os = "windows")]
fn get_install_dir() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(|p| PathBuf::from(p).join("Nexe"))
}

#[cfg(target_os = "windows")]
fn create_shortcuts(exe_path: &PathBuf) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_str = exe_path.to_string_lossy();

    // Desktop shortcut
    if let Some(desktop) = dirs_desktop() {
        let lnk = desktop.join("Nexe.lnk");
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $s = $ws.CreateShortcut('{}'); \
             $s.TargetPath = '{}'; \
             $s.WorkingDirectory = '{}'; \
             $s.IconLocation = '{},0'; \
             $s.Description = 'Nexe'; \
             $s.Save()",
            lnk.to_string_lossy(),
            exe_str,
            exe_path.parent().unwrap().to_string_lossy(),
            exe_str
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NoLogo", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    // Start Menu shortcut
    if let Some(start_menu) = dirs_start_menu() {
        let nexe_dir = start_menu.join("Nexe");
        let _ = fs::create_dir_all(&nexe_dir);
        let lnk = nexe_dir.join("Nexe.lnk");
        let script = format!(
            "$ws = New-Object -ComObject WScript.Shell; \
             $s = $ws.CreateShortcut('{}'); \
             $s.TargetPath = '{}'; \
             $s.WorkingDirectory = '{}'; \
             $s.IconLocation = '{},0'; \
             $s.Description = 'Nexe'; \
             $s.Save()",
            lnk.to_string_lossy(),
            exe_str,
            exe_path.parent().unwrap().to_string_lossy(),
            exe_str
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NoLogo", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn register_app(install_dir: &PathBuf, exe_path: &PathBuf, version: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexe";
    let exe_str = exe_path.to_string_lossy();
    let dir_str = install_dir.to_string_lossy();

    let entries = [
        ("DisplayName", "Nexe"),
        ("DisplayVersion", version),
        ("Publisher", "Nexe"),
        ("InstallLocation", &dir_str),
        ("DisplayIcon", &exe_str),
    ];

    for (name, value) in entries {
        let _ = std::process::Command::new("reg")
            .args(["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    // UninstallString
    let uninstall = format!("\"{}\" --uninstall", exe_str);
    let _ = std::process::Command::new("reg")
        .args(["add", key, "/v", "UninstallString", "/t", "REG_SZ", "/d", &uninstall, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    // NoModify, NoRepair
    for flag in ["NoModify", "NoRepair"] {
        let _ = std::process::Command::new("reg")
            .args(["add", key, "/v", flag, "/t", "REG_DWORD", "/d", "1", "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn dirs_desktop() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .ok()
        .map(|p| PathBuf::from(p).join("Desktop"))
}

#[cfg(target_os = "windows")]
fn dirs_start_menu() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|p| PathBuf::from(p).join("Microsoft").join("Windows").join("Start Menu").join("Programs"))
}
