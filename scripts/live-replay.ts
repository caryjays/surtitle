// Plays recordings as Chrome's microphone into a running service, through the live path a rehearsal uses: the control
// page's capture, the WebSocket and the service with its host probe. It turns on the control page's diagnostics, starts
// once, plays the recordings back to back with a short gap, pauses, and saves the diagnostics file for `pnpm diag:latency`.
// Start the service first, for example LANGUAGE_PAIR=en-fr pnpm dev:offline. Chrome opens in a window of its own with a
// fresh profile and a fake microphone; it reaches only the service. Offline. The diagnostics file holds timings and counts only.
import { spawnSync } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  out: { type: 'string' }, port: { type: 'string', default: '4317' },
  // Seconds of digital silence between recordings; the row before closes on it.
  gap: { type: 'string', default: '3' },
  // Headless renders nothing on screen, unlike a rehearsal; a window is the default.
  headless: { type: 'boolean', default: false },
} });
const port = Number(values.port); const gapS = Number(values.gap);
if (!values.out || !positionals.length || !Number.isInteger(port) || port < 1024 || port > 65535 || !(gapS >= 0 && gapS <= 60)) {
  console.error('Usage: pnpm replay:live --out <diagnostics.json> [--port 4317] [--gap <s>] [--headless] <audio>...'); process.exit(2);
}
const RATE = 48_000;
const second = (s: number) => Buffer.alloc(Math.round(RATE * s) * 2);
// Ten seconds before speech: warmup, then the quiet calibration.
const parts: Buffer[] = [second(10)];
for (const audio of positionals) {
  const converted = spawnSync('ffmpeg', ['-v', 'error', '-i', audio, '-f', 's16le', '-ar', String(RATE), '-ac', '1', 'pipe:1'], { maxBuffer: 1_000_000_000 });
  if (converted.status !== 0) { console.error(`Audio conversion failed: ${audio}`); process.exit(1); }
  parts.push(converted.stdout, second(gapS));
}
parts.push(second(5));
const pcm = Buffer.concat(parts); const header = Buffer.alloc(44);
header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
const wav = resolve('.local/fixtures/live-replay.wav'); await writeFile(wav, Buffer.concat([header, pcm]));
const durationMs = Math.round(pcm.length / 2 / RATE * 1000);

const origin = `http://127.0.0.1:${port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: values.headless, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: null });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const control = await context.newPage();
  await control.goto(`${origin}/control`);
  // The diagnostics buttons sit in a closed disclosure.
  await control.locator('#diagnostic-toggle').evaluate(button => { for (let d = button.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true; });
  await control.locator('#diagnostic-toggle').click();
  await control.getByRole('button', { name: 'Start microphone' }).click();
  await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('ACTIVE'), undefined, { timeout: 120_000 });
  const started = Date.now();
  console.log(`Playing ${positionals.length} recordings, about ${Math.round(durationMs / 60_000)} min.`);
  // The page keeps its latest 5,000 events, fewer than a long run makes, so a part is saved every 5 min and the parts merged.
  const exports: string[] = [];
  const save = async () => {
    const [download] = await Promise.all([control.waitForEvent('download'), control.locator('#diagnostic-download').click()]);
    const part = `${values.out}.part${exports.length + 1}`; await download.saveAs(part); exports.push(part);
  };
  while (Date.now() - started < durationMs) {
    await new Promise(r => setTimeout(r, Math.min(300_000, durationMs - (Date.now() - started))));
    if (Date.now() - started < durationMs) { await save(); console.log(`${Math.round((Date.now() - started) / 60_000)} min`); }
  }
  if (!(await control.locator('#status').textContent())?.startsWith('ACTIVE')) console.error('Capture was not active at the end of playback.');
  await control.getByRole('button', { name: 'Pause', exact: true }).click();
  await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('PAUSED'), undefined, { timeout: 60_000 });
  // Let the last translations land.
  await new Promise(r => setTimeout(r, 15_000));
  await save();
  type Export = { events: { atMs: number }[]; dropped: number } & Record<string, unknown>;
  const files = await Promise.all(exports.map(async path => JSON.parse(await readFile(path, 'utf8')) as Export));
  const merged = new Map<string, { atMs: number }>();
  for (const file of files) for (const event of file.events) merged.set(JSON.stringify(event), event);
  const events = [...merged.values()].sort((a, b) => a.atMs - b.atMs);
  // Only the first part may have dropped events the later parts don't hold; with parts 5 min apart none are lost.
  await writeFile(values.out, `${JSON.stringify({ ...files.at(-1), count: events.length, dropped: files[0]!.dropped, events })}\n`);
  await Promise.all(exports.map(path => unlink(path)));
  console.log(`Wrote ${events.length} events from ${exports.length} parts: ${values.out}`);
} finally { await browser?.close(); await unlink(wav).catch(() => {}); }
