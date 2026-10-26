import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Controller } from '../apps/service/controller.ts';
import { createCaptionServer } from '../apps/service/server.ts';
import { localTranscriberFactory } from '../packages/providers/local.ts';
import type { TranslationInput } from '../packages/protocol/index.ts';
import { loadGlossary, resolveGlossaryPath } from '../apps/service/glossary.ts';

async function main() {
  const listening = process.argv.includes('--listen');
  const manifest = z.array(z.object({ id: z.string(), sha256: z.string() })).parse(JSON.parse(await readFile('benchmarks/fleurs.json', 'utf8')));
  const parts: Buffer[] = [Buffer.alloc(48_000 * 2 * 10)]; // Initialization silence, not a live latency measurement.
  if (listening) {
    // Non-speech above the old RMS threshold, then a clean pause. No recording.
    const noise = Buffer.alloc(48_000 * 2 * 6); let seed = 4317;
    for (let i = 0; i < noise.length; i += 2) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise.writeInt16LE(Math.round(((seed / 0x100000000) * 2 - 1) * 0.045 * 32767), i);
    }
    parts.push(noise, Buffer.alloc(48_000 * 2 * 2));
  }
  for (const id of ['en_us-1675', 'ja_jp-1828']) {
    const path = `.local/fixtures/${id}.wav`;
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), manifest.find(f => f.id === id)?.sha256);
    const conversion = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1'], { maxBuffer: 2_000_000 });
    assert.equal(conversion.status, 0); parts.push(conversion.stdout, Buffer.alloc(48_000 * 2 * 2));
  }
  const pcm = Buffer.concat(parts); const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const replayPath = resolve('.local/fixtures/browser-replay.wav'); await writeFile(replayPath, Buffer.concat([header, pcm]));
  const glossary = listening ? await loadGlossary((await resolveGlossaryPath()).path) : [];
  const requests: TranslationInput[] = [];
  let partialSeen = false;
  const controller = new Controller({ backend: listening ? 'Local transcription · FAKE translation' : 'Local transcription · translation off',
    processing: listening ? 'local-audio-cloud-text' : 'local-only', glossary, sessionLimitMs: null,
    translator: listening ? { async translate(input) {
      requests.push(input);
      return input.sourceLanguage === 'ja' ? { source: 'ja', target: 'en', text: 'Japanese fixture translation (fake).' }
        : { source: 'en', target: 'ja', text: '英語のテスト翻訳（フェイク）。' };
    } } : null,
    transcriber: localTranscriberFactory({ model: 'turbo-q4', previewIntervalMs: listening ? 3000 : undefined,
      calibrationMs: listening ? 1500 : undefined }) });
  controller.subscribe(() => { if (controller.snapshot().segments.some(row => row.state === 'partial' && row.original)) partialSeen = true; });
  const app = await createCaptionServer({ controller, port: 0, webDir: 'dist/web', configured: true });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${replayPath}`, '--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext(); const errors: string[] = [];
    await context.route('**/*', route => route.request().url().startsWith(app.origin + '/') ? route.continue() : route.abort());
    const control = await context.newPage(); const overlay = await context.newPage();
    control.on('pageerror', () => errors.push('control')); overlay.on('pageerror', () => errors.push('overlay'));
    await overlay.addInitScript("Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => { throw new Error('Overlay capture prohibited'); } });");
    await control.goto(app.origin + '/control'); await overlay.goto(app.origin + '/overlay');
    await control.getByRole('button', { name: 'Start microphone' }).click();
    await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('ACTIVE'), undefined, { timeout: 60_000 });
    await overlay.waitForSelector('.original[lang="en"]', { timeout: 60_000 });
    if (listening) {
      assert.equal(requests.length, 1, 'non-speech prelude must not produce translation requests');
      assert.equal(requests[0]!.sourceLanguage, 'en');
    }
    await overlay.reload(); await overlay.waitForSelector('.original[lang="en"]');
    await overlay.waitForSelector('.original[lang="ja"]', { timeout: 60_000 });
    if (listening) {
      await overlay.waitForSelector('.translation[lang="en"]', { timeout: 60_000 });
      assert(requests.some(request => request.sourceLanguage === 'en'));
      assert(requests.some(request => request.sourceLanguage === 'ja'));
      assert(requests.every(request => request.mode === 'auto'));
      assert(requests.some(request => request.context?.length));
      assert.match(await control.locator('#processing').textContent() ?? '', /recent context/);
    } else {
      assert.equal(await overlay.locator('.translation').count(), 0);
      assert.equal(await control.locator('#processing').textContent(), 'Audio stays on this Mac. Translation is OFF; original-language captions only.');
    }
    await control.getByRole('button', { name: 'Pause', exact: true }).click();
    await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('PAUSED'));
    assert.deepEqual(errors, []);
    console.log(listening
      ? `PASS: non-speech prelude produces no translation; public EN/JA → real speech gate + MLX with previews → FAKE bidirectional translation/context; reload/pause. Provisional source observed: ${partialSeen}. No cloud calls or real microphone.`
      : 'PASS: public EN→JA prerecorded speech → Chrome AudioWorklet → local MLX → original-only overlay; reload/pause; no cloud calls or real microphone.');
  } finally { await browser?.close(); await app.close(); await unlink(replayPath); }
}
void main().catch(() => { console.error('Local browser smoke failed. Check local setup and Chrome availability. Details suppressed.'); process.exitCode = 1; });
