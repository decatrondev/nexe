use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const API_URL: &str = "https://nexeapi.decatron.net";
const MAX_APPLY_ATTEMPTS: u32 = 2;

// ── Types ──

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub update_available: bool,
    pub version: String,
    pub current_version: String,
    pub download_url: Option<String>,
    pub sha256: Option<String>,
    pub size: Option<i64>,
    pub notes: Option<String>,
    pub deb_url: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

// ── Tauri Commands ──

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let version = app.package_info().version.to_string();
    let platform = get_platform();

    let url = format!(
        "{}/update/check?version={}&platform={}",
        API_URL, version, platform
    );

    let client = Client::new();
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let mut info: UpdateInfo = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Skip version that previously failed to apply (anti-loop)
    if info.update_available {
        if let Ok(updates_dir) = get_updates_dir(&app) {
            let skip_file = updates_dir.join(".skip_version");
            if let Ok(skipped) = fs::read_to_string(&skip_file) {
                let skipped = skipped.trim();
                if skipped == info.version || skipped == "any" {
                    log::info!("Skipping update {} — previously failed to apply", info.version);
                    info.update_available = false;
                    info.download_url = None;
                    // Clear "any" skip after one cycle so future versions can be tried
                    if skipped == "any" {
                        let _ = fs::remove_file(&skip_file);
                    }
                } else {
                    // New version available, clear the skip
                    let _ = fs::remove_file(&skip_file);
                }
            }
        }
    }

    Ok(info)
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    download_url: String,
    expected_sha256: String,
    target_version: String,
) -> Result<(), String> {
    let updates_dir = get_updates_dir(&app)?;
    let download_dir = updates_dir.join("download");
    let staged_dir = updates_dir.join("staged");

    // Clean previous
    let _ = fs::remove_dir_all(&download_dir);
    let _ = fs::remove_dir_all(&staged_dir);
    fs::create_dir_all(&download_dir).map_err(|e| format!("Create dir: {}", e))?;
    fs::create_dir_all(&staged_dir).map_err(|e| format!("Create dir: {}", e))?;

    let zip_path = download_dir.join("update.zip");

    // Download with progress
    let client = Client::new();
    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut hasher = Sha256::new();

    let mut file = fs::File::create(&zip_path).map_err(|e| format!("Create file: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit("update-progress", DownloadProgress { downloaded, total, percent });
    }
    drop(file);

    // Verify SHA256
    let hash = format!("{:x}", hasher.finalize());
    if !expected_sha256.is_empty() && hash != expected_sha256 {
        let _ = fs::remove_dir_all(&download_dir);
        return Err(format!(
            "SHA256 mismatch: expected {}, got {}",
            expected_sha256, hash
        ));
    }

    // Extract zip to staged
    extract_zip(&zip_path, &staged_dir)?;

    // Write completion marker and target version
    fs::write(staged_dir.join(".complete"), "ok")
        .map_err(|e| format!("Write marker: {}", e))?;
    fs::write(staged_dir.join(".version"), &target_version)
        .map_err(|e| format!("Write version: {}", e))?;

    // Clear any previous skip (we're downloading a new update)
    let skip_file = updates_dir.join(".skip_version");
    let _ = fs::remove_file(&skip_file);

    // Clean download
    let _ = fs::remove_dir_all(&download_dir);

    Ok(())
}

/// Download a .deb file and install it via pkexec dpkg -i (Linux only).
#[tauri::command]
pub async fn install_deb_update(
    app: AppHandle,
    deb_url: String,
) -> Result<(), String> {
    let updates_dir = get_updates_dir(&app)?;
    let download_dir = updates_dir.join("download");

    let _ = fs::remove_dir_all(&download_dir);
    fs::create_dir_all(&download_dir).map_err(|e| format!("Create dir: {}", e))?;

    let deb_path = download_dir.join("nexe-update.deb");

    // Download with progress
    let client = Client::new();
    let resp = client
        .get(&deb_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = fs::File::create(&deb_path).map_err(|e| format!("Create file: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit("update-progress", DownloadProgress { downloaded, total, percent });
    }
    drop(file);

    // Install via pkexec (prompts for admin password)
    let output = std::process::Command::new("pkexec")
        .args(["dpkg", "-i", &deb_path.to_string_lossy()])
        .output()
        .map_err(|e| format!("Failed to run pkexec: {}", e))?;

    // Clean up
    let _ = fs::remove_dir_all(&download_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("dpkg install failed: {}", stderr));
    }

    Ok(())
}

// ── Startup: Apply staged update ──

/// Returns true if an update was applied (caller should restart the process).
pub fn apply_staged_update(app: &AppHandle) -> bool {
    let updates_dir = match get_updates_dir(app) {
        Ok(d) => d,
        Err(_) => return false,
    };

    let staged_dir = updates_dir.join("staged");
    if !staged_dir.join(".complete").exists() {
        return false;
    }

    // Anti-loop: max attempts
    let attempts_file = updates_dir.join(".apply_attempts");
    let attempts: u32 = fs::read_to_string(&attempts_file)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);

    if attempts >= MAX_APPLY_ATTEMPTS {
        log::error!("Staged update failed {} times — removing to break loop", attempts);
        let _ = fs::remove_dir_all(&staged_dir);
        let _ = fs::remove_file(&attempts_file);
        // Remember the target version so we don't re-download it.
        // Read it from the staged .version file if available.
        let skip_file = updates_dir.join(".skip_version");
        let version_file = staged_dir.join(".version");
        if let Ok(target_version) = fs::read_to_string(&version_file) {
            let _ = fs::write(&skip_file, target_version.trim());
            log::info!("Skipping future updates for version {}", target_version.trim());
        } else {
            // Fallback: skip any update for 24 hours
            let _ = fs::write(&skip_file, "any");
            log::info!("Skipping all updates temporarily (failed version unknown)");
        }
        return false;
    }
    let _ = fs::write(&attempts_file, (attempts + 1).to_string());

    // Linux AppImage: replace the AppImage file directly
    #[cfg(target_os = "linux")]
    {
        if let Ok(appimage_path) = std::env::var("APPIMAGE") {
            log::info!("Linux AppImage detected: {:?}", appimage_path);
            let result = apply_appimage_update(&staged_dir, &appimage_path);
            let _ = fs::remove_dir_all(&staged_dir);
            let _ = fs::remove_file(&attempts_file);
            if result {
                log::info!("AppImage update applied successfully");
            } else {
                log::error!("AppImage update failed");
            }
            return result;
        }
        // Not an AppImage — fall through to generic Unix path
    }

    // macOS: replace the .app bundle
    #[cfg(target_os = "macos")]
    {
        if let Some(result) = apply_macos_update(&staged_dir) {
            let _ = fs::remove_dir_all(&staged_dir);
            let _ = fs::remove_file(&attempts_file);
            if result {
                log::info!("macOS .app update applied successfully");
            } else {
                log::error!("macOS .app update failed");
            }
            return result;
        }
        // No .app found in staged — fall through to generic path
    }

    let app_dir = match get_app_dir() {
        Some(d) => d,
        None => return false,
    };

    log::info!("Applying staged update from {:?} to {:?}", staged_dir, app_dir);

    let entries = match fs::read_dir(&staged_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }

        let src = entry.path();
        let dst = app_dir.join(&name);

        if dst.exists() {
            // On Windows: rename locked exe/dll to .old (can rename while running)
            #[cfg(target_os = "windows")]
            {
                let ext = dst
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                if ext == "exe" || ext == "dll" {
                    let old_path = dst.with_extension(format!("{}.old", ext));
                    let _ = fs::remove_file(&old_path);
                    if let Err(e) = fs::rename(&dst, &old_path) {
                        log::error!("Failed to rename {:?} to .old: {}", dst, e);
                        return false; // Abort — don't leave partial state
                    }
                } else {
                    let _ = fs::remove_file(&dst);
                }
            }

            // On Unix: just remove (or overwrite)
            #[cfg(not(target_os = "windows"))]
            {
                if dst.is_dir() {
                    let _ = fs::remove_dir_all(&dst);
                } else {
                    let _ = fs::remove_file(&dst);
                }
            }
        }

        if src.is_dir() {
            if let Err(e) = copy_dir_recursive(&src, &dst) {
                log::error!("Failed to copy dir {:?}: {}", src, e);
                return false;
            }
        } else if let Err(e) = fs::copy(&src, &dst) {
            log::error!("Failed to copy {:?} → {:?}: {}", src, dst, e);
            return false;
        }

        // Set executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&dst) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&dst, perms);
            }
        }
    }

    // Success — clean up
    let _ = fs::remove_dir_all(&staged_dir);
    let _ = fs::remove_file(&attempts_file);

    // Windows: update registry version + refresh shortcuts and icon cache
    #[cfg(target_os = "windows")]
    {
        let version = app.package_info().version.to_string();
        post_update_windows(&app_dir, &version);
    }

    log::info!("Staged update applied successfully");
    true
}

/// Linux: replace the running AppImage with the new one from staged dir.
#[cfg(target_os = "linux")]
fn apply_appimage_update(staged_dir: &Path, appimage_path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;

    let appimage = Path::new(appimage_path);

    // Find the .AppImage file in staged dir
    let new_appimage = find_file_by_ext(staged_dir, "AppImage")
        .or_else(|| find_file_by_ext(staged_dir, "appimage"));

    let src = match new_appimage {
        Some(p) => p,
        None => {
            // No AppImage in staged — maybe the zip contains the raw binary.
            // Find any ELF binary and try to use it as a replacement.
            // But for AppImage this won't work, so skip.
            log::error!("No .AppImage file found in staged update — cannot update AppImage");
            return false;
        }
    };

    // Replace the old AppImage: rename old to .old, copy new, delete old
    let old_backup = appimage.with_extension("AppImage.old");
    let _ = fs::remove_file(&old_backup);

    if let Err(e) = fs::rename(appimage, &old_backup) {
        log::error!("Failed to rename old AppImage: {}", e);
        return false;
    }

    if let Err(e) = fs::copy(&src, appimage) {
        log::error!("Failed to copy new AppImage: {}", e);
        // Try to restore
        let _ = fs::rename(&old_backup, appimage);
        return false;
    }

    // Make executable
    if let Ok(meta) = fs::metadata(appimage) {
        let mut perms = meta.permissions();
        perms.set_mode(0o755);
        let _ = fs::set_permissions(appimage, perms);
    }

    // Clean up backup
    let _ = fs::remove_file(&old_backup);

    true
}

/// macOS: replace the .app bundle at its current location.
#[cfg(target_os = "macos")]
fn apply_macos_update(staged_dir: &Path) -> Option<bool> {
    // Find a .app directory in staged
    let app_bundle = fs::read_dir(staged_dir).ok()?.flatten().find(|e| {
        e.file_name().to_string_lossy().ends_with(".app") && e.path().is_dir()
    })?;

    let src_app = app_bundle.path();

    // Find the current .app bundle by walking up from current_exe
    // current_exe is like /Applications/Nexe.app/Contents/MacOS/nexe
    let exe = std::env::current_exe().ok()?;
    let app_dir = exe.ancestors().find(|p| {
        p.extension().map_or(false, |ext| ext == "app")
    })?;

    let app_path = app_dir.to_path_buf();
    let old_backup = app_path.with_extension("app.old");

    log::info!("macOS: replacing {:?} with {:?}", app_path, src_app);

    let _ = fs::remove_dir_all(&old_backup);

    if let Err(e) = fs::rename(&app_path, &old_backup) {
        log::error!("Failed to rename old .app: {}", e);
        return Some(false);
    }

    if let Err(e) = copy_dir_recursive(&src_app, &app_path) {
        log::error!("Failed to copy new .app: {}", e);
        let _ = fs::rename(&old_backup, &app_path);
        return Some(false);
    }

    let _ = fs::remove_dir_all(&old_backup);

    Some(true)
}

fn find_file_by_ext(dir: &Path, ext: &str) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let p = e.path();
        if p.is_file() && p.extension().map_or(false, |x| x == ext) {
            Some(p)
        } else {
            None
        }
    })
}

pub fn cleanup_old_files() {
    let app_dir = match get_app_dir() {
        Some(d) => d,
        None => return,
    };

    if let Ok(entries) = fs::read_dir(&app_dir) {
        for entry in entries.flatten() {
            let name = entry.path().to_string_lossy().to_string();
            if name.ends_with(".exe.old") || name.ends_with(".dll.old") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

// ── Helpers ──

fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-x86_64"
    } else if cfg!(target_os = "macos") {
        "darwin-universal"
    } else {
        "linux-x86_64"
    }
}

fn get_app_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
}

fn get_updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir: {}", e))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("Create dir: {}", e))?;
    Ok(dir)
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("Open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Read zip: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Zip entry {}: {}", i, e))?;

        let name = entry.name().to_string();
        let out_path = dest.join(&name);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Create dir {:?}: {}", out_path, e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Create parent: {}", e))?;
            }
            let mut outfile = fs::File::create(&out_path)
                .map_err(|e| format!("Create {:?}: {}", out_path, e))?;
            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Extract {:?}: {}", out_path, e))?;
        }
    }
    Ok(())
}

/// After applying an update on Windows: update registry version, recreate shortcuts, refresh icon cache.
#[cfg(target_os = "windows")]
fn post_update_windows(app_dir: &PathBuf, version: &str) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_path = app_dir.join("Nexe.exe");
    let exe_str = exe_path.to_string_lossy();

    // Update version in Add/Remove Programs registry
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexe";
    let _ = std::process::Command::new("reg")
        .args(["add", key, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    // Recreate desktop shortcut (refreshes icon)
    if let Some(desktop) = std::env::var("USERPROFILE").ok().map(|p| PathBuf::from(p).join("Desktop")) {
        let lnk = desktop.join("Nexe.lnk");
        if lnk.exists() {
            let script = format!(
                "$ws = New-Object -ComObject WScript.Shell; \
                 $s = $ws.CreateShortcut('{}'); \
                 $s.TargetPath = '{}'; \
                 $s.WorkingDirectory = '{}'; \
                 $s.IconLocation = '{},0'; \
                 $s.Description = 'Nexe'; \
                 $s.Save()",
                lnk.to_string_lossy(), exe_str,
                app_dir.to_string_lossy(), exe_str
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NoLogo", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    // Refresh icon cache
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(wEventId: i32, uFlags: u32, dwItem1: *const u8, dwItem2: *const u8);
    }
    const SHCNE_ASSOCCHANGED: i32 = 0x08000000;
    const SHCNF_IDLIST: u32 = 0x0000;
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}
