import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmResampler } from '../apps/web/audio.ts';
import { TurnDetector } from '../packages/providers/turns.ts';
import { FRAME_BYTES, FRAME_SAMPLES } from '../packages/protocol/index.ts';
export function frame(amplitude = 0.1) {
  const pcm = new Uint8Array(FRAME_BYTES); const view = new DataView(pcm.buffer);
  for (let i = 0; i < FRAME_SAMPLES; i++) view.setInt16(i * 2, Math.round(amplitude * 32767), true);
  return pcm;
}
for (const rate of [24000, 44100, 48000, 96000]) test(`resamples ${rate} Hz to exact mono PCM24k across arbitrary blocks`, () => {
  const frames: ArrayBuffer[] = [];
  const resampler = new PcmResampler(rate, pcm => frames.push(pcm));
  for (let i = 0; i < rate; i += 128) resampler.push([new Float32Array(Math.min(128, rate - i)).fill(.25), new Float32Array(Math.min(128, rate - i)).fill(.75)]);
  assert.equal(frames.length, 20);
  for (const pcm of frames) { assert.equal(pcm.byteLength, 2400); assert(Math.abs(new DataView(pcm).getInt16(0, true) - 16384) <= 1); }
});
test('VAD keeps preroll, ignores silence, commits after 700ms pause, and bounds uninterrupted speech', () => {
  let begins = 0; let commits = 0; let frames = 0;
  const vad = new TurnDetector({ begin() { begins++; }, append() { frames++; }, commit() { commits++; } });
  for (let i = 0; i < 100; i++) vad.push(frame(0));
  assert.equal(begins, 0); vad.push(frame()); assert.equal(begins, 1); assert.equal(frames, 6);
  for (let i = 0; i < 13; i++) vad.push(frame(0)); assert.equal(commits, 0);
  vad.push(frame(0)); assert.equal(commits, 1);
  for (let i = 0; i < 240; i++) vad.push(frame()); assert.equal(commits, 2);
  vad.push(frame()); vad.finish(); assert.equal(commits, 3); vad.finish(); assert.equal(commits, 3);
});
test('turn metadata distinguishes silence, duration cap, flush, mode change, pause and calibration without changing boundaries', () => {
  const commits: { boundary: string; audioMs: number; trailingQuietMs: number }[] = [];
  const vad = new TurnDetector({ begin() {}, append() {}, commit(detail) { commits.push(detail); } }, { maxTurnMs: 1000 });
  vad.push(frame()); for (let i = 0; i < 14; i++) vad.push(frame(0));
  assert.deepEqual(commits[0], { boundary: 'silence', audioMs: 750, trailingQuietMs: 700 });
  for (let i = 0; i < 20; i++) vad.push(frame());
  assert.deepEqual(commits[1], { boundary: 'max-duration', audioMs: 1000, trailingQuietMs: 0 });
  for (const reason of ['flush', 'mode-change', 'pause', 'recalibration'] as const) { vad.push(frame()); vad.finish(reason); }
  assert.deepEqual(commits.slice(2).map(commit => commit.boundary), ['flush', 'mode-change', 'pause', 'recalibration']);
  assert(commits.every(commit => commit.audioMs >= 100));
});
test('invalid frames are rejected and short pause flush is padded to minimum commit duration', () => {
  let frames = 0; let commits = 0;
  const vad = new TurnDetector({ begin() {}, append() { frames++; }, commit() { commits++; } });
  assert.throws(() => vad.push(new Uint8Array(1))); vad.push(frame()); vad.finish();
  assert.equal(frames, 2); assert.equal(commits, 1);
});
function tone(amplitude: number, dc = 0) {
  const pcm = new Uint8Array(FRAME_BYTES); const view = new DataView(pcm.buffer);
  for (let i = 0; i < FRAME_SAMPLES; i++) view.setInt16(i * 2, Math.round((dc + amplitude * Math.sin(2 * Math.PI * 440 * i / 24000)) * 32767), true);
  return pcm;
}
test('calibrated gate rejects steady ambient levels that exceeded the old fixed threshold', () => {
  let begins = 0; let commits = 0;
  const vad = new TurnDetector({ begin() { begins++; }, append() {}, commit() { commits++; } }, { calibrationMs: 1500 });
  assert.equal(vad.status().state, 'calibrating');
  for (let i = 0; i < 30; i++) vad.push(tone(0.04));
  assert.equal(vad.status().state, 'quiet'); assert(vad.status().threshold > 0.012);
  for (let i = 0; i < 600; i++) vad.push(tone(0.04)); // 30 seconds, no ASR turn.
  assert.equal(begins, 0); assert.equal(commits, 0);
  for (let i = 0; i < 6; i++) vad.push(tone(0.2));
  assert.equal(begins, 1);
  for (let i = 0; i < 14; i++) vad.push(tone(0.04));
  assert.equal(commits, 1);
});
test('calibration ignores DC offsets and isolated clicks; recalibration resets onset', () => {
  let begins = 0;
  const vad = new TurnDetector({ begin() { begins++; }, append() {}, commit() {} }, { calibrationMs: 1500 });
  for (let i = 0; i < 30; i++) vad.push(tone(0, 0.3));
  for (let i = 0; i < 50; i++) vad.push(tone(0, 0.3));
  assert.equal(begins, 0);
  vad.push(tone(0.2)); for (let i = 0; i < 20; i++) vad.push(tone(0));
  assert.equal(begins, 0);
  vad.calibrate(); assert.equal(vad.status().remainingMs, 1500);
  for (let i = 0; i < 30; i++) vad.push(tone(0));
  for (let i = 0; i < 3; i++) vad.push(tone(0.05));
  assert.equal(begins, 1);
});
test('calibrated gate warns when sound that swings like speech stays under it, and not on steady noise', () => {
  let begins = 0;
  const vad = new TurnDetector({ begin() { begins++; }, append() {}, commit() {} }, { calibrationMs: 1500 });
  // Calibrated while someone spoke: the threshold lands above the speech that follows.
  for (let i = 0; i < 30; i++) vad.push(tone(0.08));
  const threshold = vad.status().threshold;
  for (let i = 0; i < 199; i++) vad.push(tone(i % 8 < 4 ? 0.07 : 0.005));
  assert.equal(vad.status().masked, undefined); // not before 10 s of it
  for (let i = 0; i < 40; i++) vad.push(tone(i % 8 < 4 ? 0.07 : 0.005));
  assert.equal(begins, 0); assert.equal(vad.status().masked, true); assert(vad.status().threshold <= threshold);
  // A turn opening clears it, and so does a recalibration.
  for (let i = 0; i < 3; i++) vad.push(tone(0.5));
  assert.equal(begins, 1); assert.equal(vad.status().masked, undefined);
  const steady = new TurnDetector({ begin() { begins++; }, append() {}, commit() {} }, { calibrationMs: 1500 });
  for (let i = 0; i < 30; i++) steady.push(tone(0.04));
  for (let i = 0; i < 400; i++) steady.push(tone(0.04 + (i % 3) * 0.002));
  assert.equal(steady.status().masked, undefined);
  const quiet = new TurnDetector({ begin() {}, append() {}, commit() {} }, { calibrationMs: 1500 });
  for (let i = 0; i < 30; i++) quiet.push(tone(0));
  for (let i = 0; i < 400; i++) quiet.push(tone(i % 8 < 4 ? 0.0015 : 0.0001)); // far below the gate's floor: not speech worth a warning
  assert.equal(quiet.status().masked, undefined);
  for (let i = 0; i < 400; i++) quiet.push(tone(i % 8 < 4 ? 0.0045 : 0.0003)); // faint speech just under the 0.004 floor (RMS)
  assert.equal(quiet.status().masked, true);
});
test('a gate carried over from a replaced stream needs no calibration and opens on the first speech', () => {
  let begins = 0;
  const vad = new TurnDetector({ begin() { begins++; }, append() {}, commit() {} }, { calibrationMs: 1500, threshold: 0.05 });
  assert.deepEqual([vad.status().state, vad.status().remainingMs], ['quiet', 0]); assert(Math.abs(vad.status().threshold - 0.05) < 1e-9);
  for (let i = 0; i < 3; i++) vad.push(tone(0.03));
  assert.equal(begins, 0);
  for (let i = 0; i < 3; i++) vad.push(tone(0.2));
  assert.equal(begins, 1);
  assert.throws(() => new TurnDetector({ begin() {}, append() {}, commit() {} }, { calibrationMs: 1500, threshold: 2 }));
});
