import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface UpdateInfo {
  update_available: boolean;
  version: string;
  current_version: string;
  download_url?: string;
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
  | { stage: "downloading"; progress: number }
  | { stage: "installing" }
  | { stage: "restarting" }
  | { stage: "no-update" }
  | { stage: "error"; message: string };

export type UpdateCallback = (status: UpdateStatus) => void;

export async function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_update");
}

export async function downloadUpdate(
  downloadUrl: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<void> {
  const unlisten = await listen<DownloadProgress>("update-progress", (event) => {
    onProgress(event.payload);
  });

  try {
    await invoke("download_update", { downloadUrl });
  } finally {
    unlisten();
  }
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/**
 * Full update flow for the splash window.
 * Returns true if an update was downloaded and the app needs to relaunch.
 */
export async function runUpdateFlow(onStatus: UpdateCallback): Promise<boolean> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      onStatus({ stage: "no-update" });
      return false;
    }

    onStatus({ stage: "checking" });

    const info = await checkForUpdate();

    if (!info.update_available || !info.download_url) {
      onStatus({ stage: "no-update" });
      return false;
    }

    onStatus({ stage: "downloading", progress: 0 });

    await downloadUpdate(info.download_url, (progress) => {
      onStatus({ stage: "downloading", progress: progress.percent });
    });

    onStatus({ stage: "installing" });
    await new Promise((r) => setTimeout(r, 300));

    onStatus({ stage: "restarting" });
    await new Promise((r) => setTimeout(r, 500));
    await relaunchApp();

    return true;
  } catch (error) {
    console.error("Update flow failed:", error);
    onStatus({ stage: "no-update" });
    return false;
  }
}
