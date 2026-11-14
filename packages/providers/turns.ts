import { FRAME_BYTES, SAMPLE_RATE, type AudioGate, type Boundary } from '../protocol/index.ts';

// Energy is still a heuristic, NOT semantic speech detection. Listen mode learns
// the ambient level before opening the gate; baseline benchmarks retain fixed RMS.
// The masked-speech warning: over 10 s with no turn, the louder frames reach a real share of the threshold and are several
// times the quieter ones. Steady noise does not swing like that. Untested on room recordings.
const MASKED = { frames: 200, minLevel: 0.002, thresholdShare: 0.3, swing: 3 };
export class TurnDetector {
  private preRoll: Uint8Array[] = [];
  private active = false;
  private duration = 0;
  private silence = 0;
  private onset = 0;
  private level = 0;
  private threshold = 0.012;
  private noiseFloor = 0;
  private calibrationRemaining = 0;
  private noiseLevels: number[] = [];
  // Levels of the last 10 s without a turn, calibrated mode only: sound that rises and falls like speech yet stays under
  // the gate means the threshold sits above the speech, which otherwise fails silently.
  private idle: number[] = [];
  private masked = false;
  constructor(private callbacks: { begin(): void; append(pcm: Uint8Array): void; commit(detail: { boundary: Boundary; audioMs: number; trailingQuietMs: number }): void },
    private options: { maxTurnMs?: number | null; calibrationMs?: number; threshold?: number } = {}) {
    // null: no maximum duration, for rolling segmentation, which bounds its own window.
    const max = options.maxTurnMs ?? 12_000;
    if (options.maxTurnMs !== null && (!Number.isFinite(max) || max < 1000 || max > 12_000)) throw new Error('Invalid turn limit');
    if (options.calibrationMs !== undefined && (!Number.isInteger(options.calibrationMs)
      || options.calibrationMs < 1000 || options.calibrationMs > 2000 || options.calibrationMs % 50)) throw new Error('Invalid calibration duration');
    this.calibrationRemaining = options.calibrationMs ?? 0;
    // A gate carried over from the stream this one replaces: no quiet is needed again, and speech during a restart
    // cannot be calibrated as noise.
    if (options.calibrationMs && options.threshold !== undefined) {
      if (!Number.isFinite(options.threshold) || options.threshold < 0.004 || options.threshold > 0.95) throw new Error('Invalid gate threshold');
      this.noiseFloor = options.threshold / 2.5; this.updateThreshold(); this.calibrationRemaining = 0;
    }
  }
  status(): AudioGate {
    return { state: this.calibrationRemaining ? 'calibrating' : this.active ? 'speech' : 'quiet',
      level: this.level, threshold: this.threshold, remainingMs: this.calibrationRemaining, ...(this.masked ? { masked: true } : {}) };
  }
  // Quiet at the end of the open turn so far; a turn closes at 700 ms of it.
  get quietMs() { return this.active ? this.silence : 0; }
  calibrate() {
    if (!this.options.calibrationMs) return;
    this.finish('recalibration'); this.calibrationRemaining = this.options.calibrationMs; this.noiseLevels = [];
    this.idle = []; this.masked = false;
  }
  private watchIdle() {
    this.idle.push(this.level);
    if (this.idle.length > MASKED.frames) this.idle.shift();
    if (this.idle.length < MASKED.frames) return;
    const sorted = [...this.idle].sort((a, b) => a - b);
    const low = sorted[Math.floor((sorted.length - 1) * 0.1)]!; const high = sorted[Math.floor((sorted.length - 1) * 0.9)]!;
    this.masked = high >= Math.max(MASKED.minLevel, this.threshold * MASKED.thresholdShare) && high >= low * MASKED.swing;
  }
  private updateThreshold() { this.threshold = Math.min(0.95, Math.max(0.004, this.noiseFloor * 2.5)); }
  push(pcm: Uint8Array) {
    if (pcm.byteLength !== FRAME_BYTES) throw new Error('Invalid PCM frame');
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let energy = 0; let sum = 0;
    const samples = pcm.byteLength / 2;
    for (let i = 0; i < pcm.byteLength; i += 2) {
      const value = view.getInt16(i, true) / 32768; energy += value ** 2; sum += value;
    }
    // Remove DC from gating measurements only. Inference receives original PCM.
    this.level = Math.sqrt(Math.max(0, energy / samples - (this.options.calibrationMs ? (sum / samples) ** 2 : 0)));
    if (this.calibrationRemaining) {
      this.noiseLevels.push(this.level); this.calibrationRemaining -= 50;
      if (!this.calibrationRemaining) {
        const sorted = this.noiseLevels.sort((a, b) => a - b);
        this.noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.9)]!;
        this.noiseLevels = []; this.updateThreshold();
      }
      return; // Calibration audio never reaches ASR, previews, or translation.
    }
    const voiced = this.level >= this.threshold * (this.active && this.options.calibrationMs ? 0.65 : 1);
    if (!this.active) {
      this.preRoll.push(pcm.slice());
      if (this.preRoll.length > 6) this.preRoll.shift();
      this.onset = voiced ? this.onset + 1 : 0;
      if (!voiced && this.options.calibrationMs) {
        // Follow slow ambient changes only while idle and below the speech gate.
        this.noiseFloor = this.noiseFloor * 0.995 + this.level * 0.005; this.updateThreshold();
      }
      if (this.onset < (this.options.calibrationMs ? 3 : 1)) { if (this.options.calibrationMs) this.watchIdle(); return; }
      this.active = true; this.idle = []; this.masked = false;
      this.callbacks.begin();
      for (const frame of this.preRoll) this.callbacks.append(frame);
      this.duration = this.preRoll.length * 50;
      this.preRoll = [];
    } else {
      this.callbacks.append(pcm);
      this.duration += pcm.byteLength / 2 / SAMPLE_RATE * 1000;
    }
    this.silence = voiced ? 0 : this.silence + 50;
    if (this.silence >= 700) this.finish('silence');
    else if (this.options.maxTurnMs !== null && this.duration >= (this.options.maxTurnMs ?? 12_000)) this.finish('max-duration');
  }
  finish(boundary: Boundary = 'flush') {
    if (this.active) {
      while (this.duration < 100) { this.callbacks.append(new Uint8Array(FRAME_BYTES)); this.duration += 50; }
      this.callbacks.commit({ boundary, audioMs: this.duration, trailingQuietMs: this.silence });
    }
    this.active = false; this.duration = 0; this.silence = 0; this.onset = 0; this.preRoll = [];
  }
}
