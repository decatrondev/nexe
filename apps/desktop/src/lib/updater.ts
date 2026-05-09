export async function checkForUpdates(): Promise<boolean> {
  try {
    // Only run in Tauri desktop, not in browser
    if (!("__TAURI_INTERNALS__" in window)) {
      return false;
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    const update = await check();
    if (update) {
      console.log(`Update available: ${update.version}`);
      await update.downloadAndInstall();
      await relaunch();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Update check failed:", error);
    return false;
  }
}
