import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface UpdateProgress {
  status: "running" | "empty" | "done" | "error";
  progress: number;
  error?: string | null;
}

type Stage = "idle" | "available" | "updating" | "ready" | "error";

/**
 * Flatpak builds can't use the built-in updater. The backend watches the Flatpak
 * portal and emits these events; this banner lets the user update and restart in-app.
 */
export default function FlatpakUpdateBanner() {
  const [stage, setStage] = useState<Stage>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const register = async () => {
      const onAvailable = await listen("flatpak-update-available", () => {
        setStage((s) => (s === "idle" || s === "error" ? "available" : s));
      });
      const onProgress = await listen<UpdateProgress>("flatpak-update-progress", (event) => {
        const { status, progress, error: err } = event.payload;
        if (status === "running") {
          setStage("updating");
          setPercent(progress);
        } else if (status === "empty") {
          setStage("idle");
        } else if (status === "done") {
          setStage("ready");
        } else if (status === "error") {
          setError(err || "Update failed");
          setStage("error");
        }
      });
      if (cancelled) {
        onAvailable();
        onProgress();
        return;
      }
      unlisteners.push(onAvailable, onProgress);

      // The update may have been detected before this component mounted.
      const pending = await invoke<unknown | null>("flatpak_pending_update");
      if (pending && !cancelled) {
        setStage((s) => (s === "idle" ? "available" : s));
      }
    };

    register().catch(() => { /* not running in Tauri */ });
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  if (stage === "idle") return null;

  const startUpdate = async () => {
    setStage("updating");
    setPercent(0);
    try {
      await invoke("flatpak_update_apply");
    } catch (e) {
      setError(String(e));
      setStage("error");
    }
  };

  const restart = async () => {
    try {
      await invoke("flatpak_restart");
    } catch (e) {
      setError(String(e));
      setStage("error");
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-72 rounded-lg border border-dark-700 bg-dark-900 p-3 shadow-2xl animate-slide-up">
      {stage === "available" && (
        <>
          <p className="text-sm text-white">A new version of Nexe is available.</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={startUpdate}
              className="rounded-md bg-nexe-500 px-3 py-1 text-sm font-medium text-white hover:bg-nexe-600"
            >
              Update
            </button>
            <button
              onClick={() => setStage("idle")}
              className="rounded-md px-3 py-1 text-sm text-dark-300 hover:text-white"
            >
              Later
            </button>
          </div>
        </>
      )}
      {stage === "updating" && (
        <>
          <p className="text-sm text-white">Updating Nexe... {percent}%</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-dark-700">
            <div className="h-full bg-nexe-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      {stage === "ready" && (
        <>
          <p className="text-sm text-white">Update installed. Restart to use the new version.</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={restart}
              className="rounded-md bg-nexe-500 px-3 py-1 text-sm font-medium text-white hover:bg-nexe-600"
            >
              Restart now
            </button>
            <button
              onClick={() => setStage("idle")}
              className="rounded-md px-3 py-1 text-sm text-dark-300 hover:text-white"
            >
              Later
            </button>
          </div>
        </>
      )}
      {stage === "error" && (
        <>
          <p className="text-sm text-red-400">Update failed: {error}</p>
          <button
            onClick={() => setStage("idle")}
            className="mt-2 rounded-md px-3 py-1 text-sm text-dark-300 hover:text-white"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
