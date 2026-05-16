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

    let info: UpdateInfo = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(info)
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    download_url: String,
    expected_sha256: String,
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

    // Write completion marker with version info
    fs::write(staged_dir.join(".complete"), "ok")
        .map_err(|e| format!("Write marker: {}", e))?;

    // Clean download
    let _ = fs::remove_dir_all(&download_dir);

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
        return false;
    }
    let _ = fs::write(&attempts_file, (attempts + 1).to_string());

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

    // Force Windows to refresh icon cache so new icons show immediately
    #[cfg(target_os = "windows")]
    refresh_icon_cache();

    log::info!("Staged update applied successfully");
    true
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

/// Tell Windows to refresh icon cache after update (taskbar, desktop shortcuts).
#[cfg(target_os = "windows")]
fn refresh_icon_cache() {
    // SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL)
    // This is the correct Windows API call to force icon cache refresh.
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
