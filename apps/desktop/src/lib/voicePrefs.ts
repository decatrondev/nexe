import { invoke } from "@tauri-apps/api/core";

/** How the microphone noise is handled. "dfn" (DeepFilterNet) is only available on the native engine. */
export type NoiseMode = "off" | "standard" | "dfn";

const KEY = "nexe:voice:noiseMode";

export function getNoiseMode(): NoiseMode {
  const saved = localStorage.getItem(KEY);
  if (saved === "off" || saved === "standard" || saved === "dfn") return saved;
  // Older versions only had an on/off switch.
  return localStorage.getItem("nexe:voice:noiseSuppression") === "false" ? "off" : "standard";
}

export function setNoiseMode(mode: NoiseMode) {
  localStorage.setItem(KEY, mode);
  // Keep the old key in step so anything still reading it agrees.
  localStorage.setItem("nexe:voice:noiseSuppression", String(mode !== "off"));
}

const on = (key: string) => localStorage.getItem(key) !== "false";

export function getEchoCancellation() { return on("nexe:voice:echoCancellation"); }
export function getAutoGain() { return on("nexe:voice:autoGain"); }

/** Applies the saved processing to a native call that is already running. No-op when not in one. */
export function applyNativeProcessing() {
  invoke("voice_set_processing", {
    echoCancellation: getEchoCancellation(),
    noiseMode: getNoiseMode(),
    autoGain: getAutoGain(),
  }).catch(() => {});
}
