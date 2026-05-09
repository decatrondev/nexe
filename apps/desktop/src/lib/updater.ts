import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdates(): Promise<boolean> {
  try {
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
