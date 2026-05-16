import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  update_available: boolean;
  version: string;
  current_version: string;
  download_url?: string;
  sha256?: string;
  size?: number;
  notes?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export type UpdateStatus =
  | { stage: "checking" }
  | { stage: "installing-app" }
  | { stage: "downloading"; progress: number }
  | { stage: "installing" }
  | { stage: "restarting" }
  | { stage: "no-update" }
  | { stage: "error"; message: string };

export type UpdateCallback = (status: UpdateStatus) => void;

/**
 * Full startup flow for the splash window:
 * 1. Self-install if needed (first time on Windows)
 * 2. Check for updates
 * 3. Download + stage if available
 */
export async function runUpdateFlow(onStatus: UpdateCallback): Promise<boolean> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      onStatus({ stage: "no-update" });
      return false;
    }

    // Step 1: Check if app needs to install itself
    try {
      const status = await invoke<string>("check_install_status");
      if (status === "needs_install") {
        onStatus({ stage: "installing-app" });
        await invoke("self_install");
        // self_install exits the process — this line won't execute
        return true;
      }
    } catch {
      // Not on Windows or install check failed, continue normally
    }

    // Step 2: Check for updates
    onStatus({ stage: "checking" });

    let info: UpdateInfo;
    try {
      info = await invoke<UpdateInfo>("check_for_update");
    } catch {
      onStatus({ stage: "no-update" });
      return false;
    }

    if (!info.update_available || !info.download_url) {
      onStatus({ stage: "no-update" });
      return false;
    }

    // Step 3: Download update
    onStatus({ stage: "downloading", progress: 0 });

    const unlisten = await listen<DownloadProgress>("update-progress", (event) => {
      onStatus({ stage: "downloading", progress: event.payload.percent });
    });

    try {
      await invoke("download_update", {
        downloadUrl: info.download_url,
        expectedSha256: info.sha256 || "",
      });
    } finally {
      unlisten();
    }

    onStatus({ stage: "restarting" });
    await new Promise((r) => setTimeout(r, 500));
    await relaunch();

    return true;
  } catch (error) {
    console.error("Update flow failed:", error);
    onStatus({ stage: "no-update" });
    return false;
  }
}
