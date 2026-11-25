/// <reference path="./worklet-env.d.ts" />
// Cuts microphone input into 10 ms mono frames (480 samples at 48 kHz) for the encoder,
// with the RMS level of each frame for the meter and voice activity detection.

const FRAME = 480;

class CaptureProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(FRAME);
  private fill = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      const n = Math.min(FRAME - this.fill, input.length - i);
      this.buf.set(input.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === FRAME) {
        let sum = 0;
        for (let k = 0; k < FRAME; k++) sum += this.buf[k] * this.buf[k];
        const frame = this.buf;
        this.port.postMessage({ frame, rms: Math.sqrt(sum / FRAME) }, [frame.buffer]);
        this.buf = new Float32Array(FRAME);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('mumh5-capture', CaptureProcessor);
