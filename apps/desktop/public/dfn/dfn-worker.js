// Runs DeepFilterNet (WebAssembly) off the audio thread: the model needs more stack than an audio
// worklet is given, and a slow block must never stall the audio. Blocks come in from dfn-worklet.js
// over a message port, are cleaned in place and sent back.
import init, { Denoiser } from "./nexe_dfn_wasm.js";

let denoiser = null;
let port = null;

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "init") return;
  try {
    await init({ module_or_path: msg.wasmUrl });
    denoiser = new Denoiser(msg.attenuation ?? 100);
    port = msg.port;
    port.onmessage = (ev) => {
      const block = new Float32Array(ev.data);
      try {
        denoiser.process(block);
      } catch {
        // Keep the audio flowing untouched rather than going silent.
      }
      port.postMessage(block.buffer, [block.buffer]);
    };
    postMessage({ type: "ready", hop: denoiser.frame_length() });
  } catch (err) {
    postMessage({ type: "error", message: String(err) });
  }
};
