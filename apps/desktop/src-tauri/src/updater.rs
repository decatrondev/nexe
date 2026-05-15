use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const API_URL: &str = "https://nexeapi.decatron.net";

// ---- Types ----

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub update_available: bool,
    pub version: String,
    pub current_version: String,
    pub download_url: Option<String>,
    pub size: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

// ---- Tauri Commands ----

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
pub async fn download_update(app: AppHandle, download_url: String) -> Result<(), String> {
    let updates_dir = get_updates_dir(&app)?;
    let download_dir = updates_dir.join("download");
    let staged_dir = updates_dir.join("staged");

    // Clean previous downloads/staging
    let _ = fs::remove_dir_all(&download_dir);
    let _ = fs::remove_dir_all(&staged_dir);
    fs::create_dir_all(&download_dir).map_err(|e| format!("Create download dir: {}", e))?;
    fs::create_dir_all(&staged_dir).map_err(|e| format!("Create staged dir: {}", e))?;

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

    let mut file =
        fs::File::create(&zip_path).map_err(|e| format!("Create zip file: {}", e))?;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download chunk error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit(
            "update-progress",
            DownloadProgress {
                downloaded,
                total,
                percent,
            },
        );
    }

    drop(file);

    // Extract zip to staged directory
    extract_zip(&zip_path, &staged_dir)?;

    // Write .complete marker
    fs::write(staged_dir.join(".complete"), "ok")
        .map_err(|e| format!("Write complete marker: {}", e))?;

    // Clean download dir
    let _ = fs::remove_dir_all(&download_dir);

    Ok(())
}

// ---- Setup Hook Functions (called from lib.rs) ----

/// Apply a staged update if one exists. Called early in app startup before windows are shown.
pub fn apply_staged_update(app: &AppHandle) {
    let updates_dir = match get_updates_dir(app) {
        Ok(d) => d,
        Err(_) => return,
    };

    let staged_dir = updates_dir.join("staged");
    let complete_marker = staged_dir.join(".complete");

    if !complete_marker.exists() {
        return;
    }

    let app_dir = match std::env::current_exe() {
        Ok(exe) => exe.parent().unwrap_or(Path::new(".")).to_path_buf(),
        Err(_) => return,
    };

    log::info!("Applying staged update from {:?} to {:?}", staged_dir, app_dir);

    // Read all files in staged dir (skip .complete marker)
    let entries = match fs::read_dir(&staged_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".complete" {
            continue;
        }

        let src = entry.path();
        let dst = app_dir.join(&name);

        // If destination exists and is an exe/dll (Windows), rename to .old first
        if dst.exists() {
            let ext = dst.extension().unwrap_or_default().to_string_lossy().to_lowercase();
            if ext == "exe" || ext == "dll" {
                let old_path = dst.with_extension(format!("{}.old", ext));
                let _ = fs::remove_file(&old_path); // Remove previous .old if exists
                if let Err(e) = fs::rename(&dst, &old_path) {
                    log::error!("Failed to rename {:?} to .old: {}", dst, e);
                    // Abort update — don't leave in partial state
                    return;
                }
            } else {
                let _ = fs::remove_file(&dst);
            }
        }

        if src.is_dir() {
            if let Err(e) = copy_dir_recursive(&src, &dst) {
                log::error!("Failed to copy dir {:?}: {}", src, e);
                return;
            }
        } else if let Err(e) = fs::copy(&src, &dst) {
            log::error!("Failed to copy {:?} to {:?}: {}", src, dst, e);
            return;
        }

        // Set executable permission on Linux/macOS
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = fs::metadata(&dst) {
                let mut perms = metadata.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&dst, perms);
            }
        }
    }

    // Clean up staging
    let _ = fs::remove_dir_all(&staged_dir);
    log::info!("Staged update applied successfully");
}

/// Clean up .old files from previous updates.
pub fn cleanup_old_files() {
    let app_dir = match std::env::current_exe() {
        Ok(exe) => exe.parent().unwrap_or(Path::new(".")).to_path_buf(),
        Err(_) => return,
    };

    if let Ok(entries) = fs::read_dir(&app_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.to_string_lossy();
            if name.ends_with(".exe.old") || name.ends_with(".dll.old") {
                let _ = fs::remove_file(&path);
            }
        }
    }
}

// ---- Helpers ----

fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows-x86_64"
    } else if cfg!(target_os = "macos") {
        "darwin-universal"
    } else {
        "linux-x86_64"
    }
}

fn get_updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Get app data dir: {}", e))?
        .join("updates");
    fs::create_dir_all(&dir).map_err(|e| format!("Create updates dir: {}", e))?;
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
                    .map_err(|e| format!("Create parent dir: {}", e))?;
            }
            let mut outfile = fs::File::create(&out_path)
                .map_err(|e| format!("Create file {:?}: {}", out_path, e))?;
            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Extract {:?}: {}", out_path, e))?;
        }
    }

    Ok(())
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
