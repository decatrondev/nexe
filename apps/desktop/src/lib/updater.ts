import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | { stage: "checking" }
  | { stage: "downloading"; progress: number }
  | { stage: "installing" }
  | { stage: "restarting" }
  | { stage: "no-update" }
  | { stage: "error"; message: string };

export type UpdateCallback = (status: UpdateStatus) => void;

/**
 * Full update flow for the splash window.
 * Returns true if an update was downloaded and the app will relaunch.
 */
export async function runUpdateFlow(onStatus: UpdateCallback): Promise<boolean> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      onStatus({ stage: "no-update" });
      return false;
    }

    onStatus({ stage: "checking" });

    let update: Update | null = null;
    try {
      update = await check();
    } catch {
      onStatus({ stage: "no-update" });
      return false;
    }

    if (!update) {
      onStatus({ stage: "no-update" });
      return false;
    }

    let totalBytes = 0;
    let downloadedBytes = 0;

    onStatus({ stage: "downloading", progress: 0 });

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength;
          const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
          onStatus({ stage: "downloading", progress: percent });
          break;
        case "Finished":
          onStatus({ stage: "installing" });
          break;
      }
    });

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
