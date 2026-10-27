import { Track, type Room, type AudioProcessorOptions, type TrackProcessor } from "livekit-client";
import { getNoiseMode } from "./voicePrefs";

/**
 * DeepFilterNet for webviews that do have WebRTC (Windows, macOS): the same model the Linux voice
 * engine uses, compiled to WebAssembly (apps/desktop/dfn-wasm) and run in an audio worklet that
 * sits between the microphone and the call. Linux never gets here, it has the native engine.
 */

const SAMPLE_RATE = 48_000;

export function dfnWebSupported(): boolean {
  return typeof AudioWorkletNode !== "undefined" && typeof WebAssembly !== "undefined";
}

/** Builds the denoising node inside `ctx` (48 kHz) and the worker that does the heavy lifting. */
async function createDfn(ctx: AudioContext): Promise<{ node: AudioWorkletNode; worker: Worker }> {
  await ctx.audioWorklet.addModule("/dfn/dfn-worklet.js");
  const node = new AudioWorkletNode(ctx, "nexe-dfn", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const worker = new Worker("/dfn/dfn-worker.js", { type: "module" });
  const link = new MessageChannel();
  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data?.type === "ready") resolve();
        else if (e.data?.type === "error") reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || "DeepFilterNet worker failed"));
      worker.postMessage(
        { type: "init", wasmUrl: new URL("/dfn/nexe_dfn_wasm_bg.wasm", location.href).href, attenuation: 100, port: link.port2 },
        [link.port2],
      );
    });
  } catch (e) {
    worker.terminate();
    throw e;
  }
  node.port.postMessage({ type: "port", port: link.port1 }, [link.port1]);
  return { node, worker };
}

/** Runs a microphone track through DeepFilterNet; returns the cleaned stream and a way to stop it. */
export async function denoiseStream(input: MediaStream): Promise<{ stream: MediaStream; stop: () => void }> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  try {
    const { node, worker } = await createDfn(ctx);
    const source = ctx.createMediaStreamSource(input);
    const dest = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(dest);
    return { stream: dest.stream, stop: () => { worker.terminate(); void ctx.close(); } };
  } catch (e) {
    void ctx.close();
    throw e;
  }
}

class DfnTrackProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "nexe-deepfilternet";
  processedTrack?: MediaStreamTrack;
  private stopFn: (() => void) | null = null;

  async init(opts: AudioProcessorOptions) {
    this.stopFn?.();
    const { stream, stop } = await denoiseStream(new MediaStream([opts.track]));
    this.stopFn = stop;
    this.processedTrack = stream.getAudioTracks()[0];
  }
  async restart(opts: AudioProcessorOptions) {
    await this.init(opts);
  }
  async destroy() {
    this.stopFn?.();
    this.stopFn = null;
    this.processedTrack = undefined;
  }
}

/** Makes the microphone of a running call match the saved noise mode. Safe to call at any time. */
export async function applyWebNoiseMode(room: Room | null) {
  const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  if (!track) return;
  const wantDfn = getNoiseMode() === "dfn" && dfnWebSupported();
  const has = track.getProcessor()?.name === "nexe-deepfilternet";
  try {
    if (wantDfn && !has) await track.setProcessor(new DfnTrackProcessor());
    else if (!wantDfn && has) await track.stopProcessor();
  } catch (e) {
    console.warn("Could not change the noise filter", e);
  }
}
