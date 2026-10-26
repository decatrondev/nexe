//! In-app updates for the Flatpak build, through the Flatpak portal
//! (org.freedesktop.portal.Flatpak). The portal watches the remote, tells us when a new
//! commit exists, installs it on request and can spawn the new version.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Serialize)]
pub struct UpdateAvailable {
    pub running_commit: String,
    pub remote_commit: String,
}

#[derive(Clone, Serialize)]
pub struct UpdateProgress {
    /// "running" | "empty" | "done" | "error"
    pub status: String,
    pub progress: u32,
    pub error: Option<String>,
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use futures_util::StreamExt;
    use std::collections::HashMap;
    use tauri::async_runtime::Mutex;
    use tauri::{Emitter, Manager};
    use zbus::zvariant::{Fd, OwnedObjectPath, OwnedValue, Value};
    use zbus::{proxy, Connection};

    const SPAWN_FLAG_LATEST_VERSION: u32 = 2;

    #[proxy(
        interface = "org.freedesktop.portal.Flatpak",
        default_service = "org.freedesktop.portal.Flatpak",
        default_path = "/org/freedesktop/portal/Flatpak"
    )]
    trait Portal {
        fn create_update_monitor(
            &self,
            options: HashMap<&str, Value<'_>>,
        ) -> zbus::Result<OwnedObjectPath>;

        #[allow(clippy::too_many_arguments)]
        fn spawn(
            &self,
            cwd_path: Vec<u8>,
            argv: Vec<Vec<u8>>,
            fds: HashMap<u32, Fd<'_>>,
            envs: HashMap<&str, &str>,
            flags: u32,
            options: HashMap<&str, Value<'_>>,
        ) -> zbus::Result<u32>;
    }

    #[proxy(
        interface = "org.freedesktop.portal.Flatpak.UpdateMonitor",
        default_service = "org.freedesktop.portal.Flatpak"
    )]
    trait UpdateMonitor {
        fn update(
            &self,
            parent_window: &str,
            options: HashMap<&str, Value<'_>>,
        ) -> zbus::Result<()>;

        #[zbus(signal)]
        fn update_available(&self, update_info: HashMap<String, OwnedValue>) -> zbus::Result<()>;

        #[zbus(signal)]
        fn progress(&self, info: HashMap<String, OwnedValue>) -> zbus::Result<()>;
    }

    pub struct Monitor(Mutex<Option<UpdateMonitorProxy<'static>>>);

    /// Last update we found. The UI may not be listening yet when it is detected (startup
    /// race), so it asks for this once it has mounted.
    pub struct Pending(std::sync::Mutex<Option<super::UpdateAvailable>>);

    fn announce(app: &AppHandle, update: super::UpdateAvailable) {
        if let Ok(mut pending) = app.state::<Pending>().0.lock() {
            *pending = Some(update.clone());
        }
        let _ = app.emit("flatpak-update-available", update);
    }

    pub fn pending(app: &AppHandle) -> Option<super::UpdateAvailable> {
        app.try_state::<Pending>()?.0.lock().ok().and_then(|p| p.clone())
    }

    /// Set at build time by the self-hosted manifest. Flathub builds leave it unset and rely
    /// only on the portal, because the commit of our own repo means nothing there.
    const SELF_HOSTED: bool = option_env!("NEXE_SELF_HOSTED_REPO").is_some();
    const POLL_SECS: u64 = 180;

    fn repo_ref_url() -> String {
        if let Ok(url) = std::env::var("NEXE_UPDATE_REF_URL") {
            return url;
        }
        format!(
            "https://nexe.decatron.net/flatpak/repo/refs/heads/app/net.decatron.Nexe/{}/stable",
            std::env::consts::ARCH
        )
    }

    fn running_commit() -> Option<String> {
        let info = std::fs::read_to_string("/.flatpak-info").ok()?;
        info.lines()
            .find_map(|l| l.strip_prefix("app-commit="))
            .map(|c| c.trim().to_string())
    }

    fn get_str(map: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
        map.get(key)
            .and_then(|v| <&str>::try_from(&**v).ok())
            .map(String::from)
    }

    fn get_u32(map: &HashMap<String, OwnedValue>, key: &str) -> Option<u32> {
        map.get(key).and_then(|v| v.downcast_ref::<u32>().ok())
    }

    pub fn start(app: &AppHandle) {
        app.manage(Monitor(Mutex::new(None)));
        app.manage(Pending(std::sync::Mutex::new(None)));

        let monitor_app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = ensure_monitor(&monitor_app).await {
                log::warn!("Flatpak update monitor unavailable: {}", e);
            }
        });

        if SELF_HOSTED {
            tauri::async_runtime::spawn(poll_repo(app.clone()));
            tauri::async_runtime::spawn(upload_diagnostics(app.clone()));
        }
    }

    /// Cap on what we send, well under the 32 KB the gateway accepts.
    const REPORT_MAX_BYTES: usize = 24_000;

    fn restart_report_path() -> Option<std::path::PathBuf> {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share"))
            })?;
        Some(base.join("restart-report.log"))
    }

    async fn send_report(app: &AppHandle, log: String) {
        let body = serde_json::json!({
            "version": app.package_info().version.to_string(),
            "commit": running_commit().unwrap_or_default(),
            "log": log,
        });
        let sent = reqwest::Client::new()
            .post(format!("{}/diagnostics/restart", crate::updater::API_URL))
            .timeout(std::time::Duration::from_secs(10))
            .json(&body)
            .send()
            .await;
        match sent {
            Ok(r) if r.status().is_success() => log::info!("Diagnostic report uploaded"),
            Ok(r) => log::warn!("Diagnostic report rejected: {}", r.status()),
            Err(e) => log::warn!("Diagnostic report not sent: {}", e),
        }
    }

    fn tail_lossy(bytes: &[u8]) -> String {
        String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(REPORT_MAX_BYTES / 2)..])
            .into_owned()
    }

    /// Two reports, sent a few seconds after startup so they also hold early output:
    /// 1. what the last restart left behind (written by restart() and its script), then deleted;
    /// 2. once per version, this sandbox's environment plus a probe of the portal spawn that the
    ///    restart relies on, so a machine where restarting fails can be told apart from one
    ///    where it works.
    async fn upload_diagnostics(app: AppHandle) {
        const PROBE_SCRIPT: &str = r#"
L="${XDG_DATA_HOME:-$HOME/.local/share}/spawn-probe.log"
{
  echo "probe-started=$(date -u +%s) pid=$$"
  echo "desktop=$XDG_CURRENT_DESKTOP session=$XDG_SESSION_TYPE display=$DISPLAY wayland=$WAYLAND_DISPLAY"
  echo "data=$XDG_DATA_HOME home=$HOME"
  ls /tmp/.X11-unix 2>&1 | sed 's/^/x11-socket: /'
  ls "$XDG_RUNTIME_DIR" 2>&1 | grep -i wayland | sed 's/^/runtime: /'
} > "$L" 2>&1
"#;

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        let Some(path) = restart_report_path() else { return };
        let dir = path.parent().map(std::path::Path::to_path_buf).unwrap_or_default();

        if let Ok(bytes) = std::fs::read(&path) {
            let _ = std::fs::remove_file(&path);
            send_report(&app, format!("[restart-report]\n{}", tail_lossy(&bytes))).await;
        }

        let marker = dir.join(format!("diag-{}", app.package_info().version));
        if marker.exists() {
            return;
        }
        let _ = std::fs::write(&marker, "");

        let probe_path = dir.join("spawn-probe.log");
        let _ = std::fs::remove_file(&probe_path);
        let spawned = spawn_script(PROBE_SCRIPT).await;
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        let probe = std::fs::read(&probe_path)
            .map(|b| tail_lossy(&b))
            .unwrap_or_else(|e| format!("(probe file not created: {})", e));
        let _ = std::fs::remove_file(&probe_path);

        let env = [
            "HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_CURRENT_DESKTOP", "XDG_SESSION_TYPE",
            "DISPLAY", "WAYLAND_DISPLAY", "GDK_BACKEND", "LANG",
        ]
        .iter()
        .map(|k| format!("{}={}", k, std::env::var(k).unwrap_or_default()))
        .collect::<Vec<_>>()
        .join("\n");
        let info = std::fs::read_to_string("/.flatpak-info").unwrap_or_default();

        send_report(
            &app,
            format!(
                "[startup-diagnostics]\nspawn={:?}\n--- probe\n{}\n--- env\n{}\n--- flatpak-info\n{}",
                spawned, probe, env, info
            ),
        )
        .await;
    }

    /// Ask our repo which commit is current and compare it with the one we are running.
    /// Returns None when up to date, offline, or when this is not a self-hosted build.
    pub async fn check_remote() -> Option<super::UpdateAvailable> {
        if !SELF_HOSTED {
            return None;
        }
        let running = running_commit()?;
        let resp = reqwest::Client::new()
            .get(repo_ref_url())
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let remote = resp.text().await.ok()?.trim().to_string();
        (remote.len() == 64 && remote != running).then(|| super::UpdateAvailable {
            running_commit: running,
            remote_commit: remote,
        })
    }

    /// Poll in the background so a new version found while the app is running reaches the UI.
    async fn poll_repo(app: AppHandle) {
        if running_commit().is_none() {
            log::warn!("Cannot read app-commit from /.flatpak-info; repo polling disabled");
            return;
        }
        let mut notified = String::new();
        loop {
            if let Some(update) = check_remote().await {
                if update.remote_commit != notified {
                    notified = update.remote_commit.clone();
                    announce(&app, update);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(POLL_SECS)).await;
        }
    }

    /// Create the portal update monitor once and start forwarding its signals to the UI.
    async fn ensure_monitor(app: &AppHandle) -> zbus::Result<UpdateMonitorProxy<'static>> {
        let Some(state) = app.try_state::<Monitor>() else {
            return Err(zbus::Error::Failure("Not running as a Flatpak".into()));
        };
        let mut guard = state.0.lock().await;
        if let Some(monitor) = guard.as_ref() {
            return Ok(monitor.clone());
        }

        let conn = Connection::session().await?;
        let portal = PortalProxy::new(&conn).await?;
        let path = portal.create_update_monitor(HashMap::new()).await?;
        let monitor = UpdateMonitorProxy::builder(&conn).path(path)?.build().await?;

        let mut available = monitor.receive_update_available().await?;
        let mut progress = monitor.receive_progress().await?;

        let progress_app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(signal) = progress.next().await {
                let Ok(args) = signal.args() else { continue };
                let info = args.info;
                let status = match get_u32(&info, "status") {
                    Some(0) => "running",
                    Some(1) => "empty",
                    Some(2) => "done",
                    _ => "error",
                };
                let error = get_str(&info, "error_message").or_else(|| get_str(&info, "error"));
                let _ = progress_app.emit(
                    "flatpak-update-progress",
                    super::UpdateProgress {
                        status: status.into(),
                        progress: get_u32(&info, "progress").unwrap_or(0),
                        error,
                    },
                );
            }
        });

        let available_app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(signal) = available.next().await {
                let Ok(args) = signal.args() else { continue };
                let info = args.update_info;
                announce(
                    &available_app,
                    super::UpdateAvailable {
                        running_commit: get_str(&info, "running-commit").unwrap_or_default(),
                        remote_commit: get_str(&info, "remote-commit").unwrap_or_default(),
                    },
                );
            }
        });

        *guard = Some(monitor.clone());
        Ok(monitor)
    }

    pub async fn apply(app: &AppHandle) -> Result<(), String> {
        // The splash is always-on-top and would cover the system permission dialog.
        if let Some(splash) = app.get_webview_window("splash") {
            let _ = splash.set_always_on_top(false);
        }
        let monitor = ensure_monitor(app).await.map_err(|e| e.to_string())?;
        monitor
            .update("", HashMap::new())
            .await
            .map_err(|e| e.to_string())
    }

    /// Run a shell script in a fresh sandbox of the latest installed version, through the portal.
    /// Returns the pid the portal reports.
    async fn spawn_script(script: &str) -> Result<u32, String> {
        let conn = Connection::session().await.map_err(|e| e.to_string())?;
        let portal = PortalProxy::new(&conn).await.map_err(|e| e.to_string())?;

        let argv: Vec<Vec<u8>> = ["sh", "-c", script]
            .iter()
            .map(|a| {
                let mut b = a.as_bytes().to_vec();
                b.push(0);
                b
            })
            .collect();

        portal
            .spawn(
                b"/\0".to_vec(),
                argv,
                HashMap::new(),
                HashMap::new(),
                SPAWN_FLAG_LATEST_VERSION,
                HashMap::new(),
            )
            .await
            .map_err(|e| e.to_string())
    }

    fn unix_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Append one line to the restart report (see upload_diagnostics).
    fn report_note(line: &str) {
        use std::io::Write;
        let Some(path) = restart_report_path() else { return };
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{}", line);
        }
    }

    /// Start the latest installed version in a fresh sandbox, then quit this instance.
    /// The short delay lets this process release the single-instance lock first.
    pub async fn restart(app: &AppHandle) -> Result<(), String> {
        // Start the new instance after this one is gone. If single-instance rejects it because
        // the old process has not released its D-Bus name yet, it exits within a second or two:
        // retry. A real session lasts far longer than 4 s, so that ends the loop.
        // This process notes what it did and the script adds what the new instance prints; the
        // new instance uploads that report on startup, so a restart that fails on a machine we
        // cannot reach can still be diagnosed.
        const RESTART_SCRIPT: &str = r#"
L="${XDG_DATA_HOME:-$HOME/.local/share}/restart-report.log"
{
  echo "script-started=$(date -u +%s)"
  echo "desktop=$XDG_CURRENT_DESKTOP session=$XDG_SESSION_TYPE display=$DISPLAY wayland=$WAYLAND_DISPLAY"
  ls /tmp/.X11-unix 2>&1 | sed 's/^/x11-socket: /'
  ls "$XDG_RUNTIME_DIR" 2>&1 | grep -i wayland | sed 's/^/runtime: /'
} >> "$L" 2>&1
sleep 2
for i in 1 2 3 4 5; do
  s=$(date +%s)
  echo "-- attempt $i" >> "$L"
  nexe 2>&1 | { head -c 6144 >> "$L"; cat > /dev/null; }
  if [ $(( $(date +%s) - s )) -ge 4 ]; then exit 0; fi
  sleep 2
done
"#;

        if let Some(path) = restart_report_path() {
            let _ = std::fs::write(
                &path,
                format!(
                    "restart-requested={} from-version={}\n",
                    unix_now(),
                    app.package_info().version
                ),
            );
        }
        match spawn_script(RESTART_SCRIPT).await {
            Ok(pid) => report_note(&format!("portal-spawn-ok pid={} at={}", pid, unix_now())),
            Err(e) => {
                report_note(&format!("portal-spawn-failed: {}", e));
                return Err(e);
            }
        }

        // Leave immediately: a graceful shutdown can take seconds on slow machines, and the
        // new instance must not find this one still holding the single-instance lock.
        report_note(&format!("exiting at={}", unix_now()));
        std::process::exit(0);
    }
}

pub fn start(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    imp::start(app);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[tauri::command]
pub async fn flatpak_update_apply(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::apply(&app).await;
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Not a Flatpak build".into())
    }
}

#[tauri::command]
pub async fn flatpak_restart(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::restart(&app).await;
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Not a Flatpak build".into())
    }
}

#[tauri::command]
pub fn flatpak_pending_update(app: AppHandle) -> Option<UpdateAvailable> {
    #[cfg(target_os = "linux")]
    return imp::pending(&app);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        None
    }
}

/// Used by the startup flow: is there a newer version in our repo? (self-hosted Flatpak only)
pub async fn check_startup() -> Option<UpdateAvailable> {
    #[cfg(target_os = "linux")]
    return imp::check_remote().await;
    #[cfg(not(target_os = "linux"))]
    None
}
