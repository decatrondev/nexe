// Audio worklet side of the DeepFilterNet filter for Windows and macOS. The model works on
// 480-sample blocks at 48 kHz and the worklet gets 128 at a time, so it collects blocks, hands
// them to dfn-worker.js over a message port and plays back what returns.
const HOP = 480;
const QUEUE = 16384;
// Two blocks of silence ahead absorb the round trip to the worker.
const PRIME = HOP * 2;

class DfnProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port2 = null;
    this.enabled = true;
    this.block = new Float32Array(HOP);
    this.filled = 0;
    this.queue = new Float32Array(QUEUE);
    this.read = 0;
    this.write = PRIME;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "port") {
        this.port2 = msg.port;
        this.port2.onmessage = (ev) => {
          const done = new Float32Array(ev.data);
          for (let i = 0; i < done.length; i++) {
            this.queue[this.write] = done[i];
            this.write = (this.write + 1) % QUEUE;
          }
        };
      } else if (msg.type === "enable") {
        this.enabled = !!msg.on;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    if (!this.port2 || !this.enabled) {
      output.set(input);
      return true;
    }
    for (let i = 0; i < input.length; i++) {
      this.block[this.filled++] = input[i];
      if (this.filled === HOP) {
        this.filled = 0;
        const out = new Float32Array(this.block);
        this.port2.postMessage(out.buffer, [out.buffer]);
      }
    }
    for (let i = 0; i < output.length; i++) {
      if (this.read === this.write) {
        output[i] = 0;
      } else {
        output[i] = this.queue[this.read];
        this.read = (this.read + 1) % QUEUE;
      }
    }
    return true;
  }
}

registerProcessor("nexe-dfn", DfnProcessor);
