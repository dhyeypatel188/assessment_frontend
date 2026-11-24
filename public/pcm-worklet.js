// Converts mic audio to 16 kHz mono 16-bit PCM and posts ~100ms chunks to the main thread.
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = [];
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    // naive downsample (average over each window) to 16 kHz
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      this.acc = (this.acc || 0) + ch[i];
      this.n = (this.n || 0) + 1;
      if (this.pos >= this.ratio) {
        this.buf.push(this.acc / this.n);
        this.acc = 0; this.n = 0; this.pos -= this.ratio;
      }
    }

    if (this.buf.length >= 480) { // 30 ms @ 16 kHz (was 100 ms) -> lower latency
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < this.buf.length; i++) {
        const s = Math.max(-1, Math.min(1, this.buf[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
