import { FRAME_SAMPLES, SAMPLE_RATE } from '../../packages/protocol/index.ts';

// Streaming area resampler: fractional positions survive render-quantum boundaries.
// Never assume that an AudioContext request changes the physical microphone rate.
export class PcmResampler {
  private remaining: number;
  private area = 0;
  private output = new ArrayBuffer(FRAME_SAMPLES * 2);
  private view = new DataView(this.output);
  private index = 0;
  private energy = 0;
  private ratio: number;
  constructor(inputRate: number, private emit: (pcm: ArrayBuffer, rms: number) => void) {
    if (!Number.isFinite(inputRate) || inputRate < SAMPLE_RATE || inputRate > 192000) throw new Error('Unsupported sample rate');
    this.ratio = inputRate / SAMPLE_RATE; this.remaining = this.ratio;
  }
  push(channels: Float32Array[]) {
    const length = channels[0]?.length ?? 0;
    for (let i = 0; i < length; i++) {
      const sample = channels.reduce((sum, c) => sum + (c[i] ?? 0), 0) / channels.length;
      let available = 1;
      while (available > 1e-9) {
        const take = Math.min(available, this.remaining);
        this.area += sample * take; this.remaining -= take; available -= take;
        if (this.remaining < 1e-9) {
          const value = Math.max(-1, Math.min(1, this.area / this.ratio));
          this.view.setInt16(this.index++ * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.energy += value * value;
          this.area = 0; this.remaining = this.ratio;
          if (this.index === FRAME_SAMPLES) {
            this.emit(this.output, Math.sqrt(this.energy / FRAME_SAMPLES));
            this.output = new ArrayBuffer(FRAME_SAMPLES * 2); this.view = new DataView(this.output); this.index = 0; this.energy = 0;
          }
        }
      }
    }
  }
}
