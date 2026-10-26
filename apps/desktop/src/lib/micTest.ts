import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { needsNativeVoice } from "./nativeRoom";

export interface MicTestOptions {
  input: string;
  output: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGain: boolean;
}

/** Input level as 0..1 on a dB scale (-60 dB .. 0 dB), the way level bars are usually drawn. */
export function levelToPercent(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-5));
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/**
 * Microphone test: live input level and optional playback of your own voice. Linux runs it in Rust
 * (its webview has no WebRTC); Windows and macOS use the webview's own audio. Changing the options
 * while it runs restarts it, so the toggles can be compared by ear.
 */
export function useMicTest(opts: MicTestOptions) {
  const [running, setRunning] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    stopRef.current?.();
    stopRef.current = null;
    setError(null);
    try {
      stopRef.current = needsNativeVoice() ? await startNative(opts, setLevel, setError, stop) : await startWeb(opts, setLevel);
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }, [opts, stop]);

  // Restart with the new options when something changes during a test.
  const key = `${opts.input}|${opts.output}|${opts.echoCancellation}|${opts.noiseSuppression}|${opts.autoGain}`;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      if (stopRef.current) void start();
    }
  }, [key, start]);

  // Never leave the microphone open after leaving the screen.
  useEffect(() => () => { stopRef.current?.(); stopRef.current = null; }, []);

  return { running, level, error, start, stop };
}

async function startNative(
  opts: MicTestOptions,
  setLevel: (v: number) => void,
  setError: (m: string) => void,
  onStopped: () => void,
): Promise<() => void> {
  const unlisten = await listen<{ rms?: number; error?: string; stopped?: boolean }>("voice://mic-level", (e) => {
    if (e.payload.error) { setError(e.payload.error); onStopped(); return; }
    if (!e.payload.stopped) setLevel(levelToPercent(e.payload.rms ?? 0));
  });
  try {
    await invoke("mic_test_start", {
      input: opts.input,
      output: opts.output,
      loopback: true,
      echoCancellation: opts.echoCancellation,
      noiseSuppression: opts.noiseSuppression,
      autoGain: opts.autoGain,
    });
  } catch (e) {
    unlisten();
    throw e;
  }
  return () => { unlisten(); invoke("mic_test_stop").catch(() => {}); };
}

async function startWeb(opts: MicTestOptions, setLevel: (v: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: opts.input ? { exact: opts.input } : undefined,
      echoCancellation: opts.echoCancellation,
      noiseSuppression: opts.noiseSuppression,
      autoGainControl: opts.autoGain,
    },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const sink = ctx.createMediaStreamDestination();
  source.connect(sink);
  const player = new Audio();
  player.srcObject = sink.stream;
  const withSink = player as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (opts.output && withSink.setSinkId) await withSink.setSinkId(opts.output).catch(() => {});
  await player.play().catch(() => {});

  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    setLevel(levelToPercent(Math.sqrt(sum / buf.length)));
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf);
    player.pause();
    player.srcObject = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}
