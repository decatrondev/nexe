export type UpdateStatus =
  | { stage: "checking" }
  | { stage: "downloading"; progress: number }
  | { stage: "installing" }
  | { stage: "restarting" }
  | { stage: "no-update" }
  | { stage: "error"; message: string };

export type UpdateCallback = (status: UpdateStatus) => void;

export async function checkAndInstallUpdate(onStatus: UpdateCallback): Promise<boolean> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      onStatus({ stage: "no-update" });
      return false;
    }

    onStatus({ stage: "checking" });

    const { check } = await import("@tauri-apps/plugin-updater");
    const { relaunch } = await import("@tauri-apps/plugin-process");

    const update = await check();

    if (!update) {
      onStatus({ stage: "no-update" });
      return false;
    }

    onStatus({ stage: "downloading", progress: 0 });

    let totalBytes = 0;
    let downloadedBytes = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        totalBytes = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0;
        onStatus({ stage: "downloading", progress });
      } else if (event.event === "Finished") {
        onStatus({ stage: "installing" });
      }
    });

    onStatus({ stage: "restarting" });

    // Brief pause so user sees "Installing..." before restart
    await new Promise((r) => setTimeout(r, 500));
    await relaunch();
    return true;
  } catch (error) {
    // Don't show error to user — just skip update silently
    console.error("Update check failed:", error);
    onStatus({ stage: "no-update" });
    return false;
  }
}
