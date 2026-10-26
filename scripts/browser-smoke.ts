import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Controller } from '../apps/service/controller.ts';
import { createCaptionServer } from '../apps/service/server.ts';
import type { Mode, TranslationInput } from '../packages/protocol/index.ts';

// Synthetic microphone + fake providers only. No .env, keys, retention, or paid calls.
let totalFrames = 0; let opened = 0; let closed = 0; let flushes = 0; let calibrations = 0;
const requests: TranslationInput[] = []; const modes: Mode[] = [];
const controller = new Controller({ backend: 'Synthetic smoke test', processing: 'local-audio-cloud-text', glossary: [], sessionLimitMs: null,
  transcriber: options => {
    const stream = ++opened; let frames = 0; let turn = 0; let mode = options.mode; let quietFrames = 30;
    const gate = () => options.onGate?.({ state: quietFrames ? 'calibrating' : 'quiet', level: 0.01, threshold: quietFrames ? 0.025 : 0.04, remainingMs: quietFrames * 50 });
    let current: { id: string; text: string; language: 'en' | 'ja' } | undefined;
    function finalize() {
      if (!current) return;
      options.onTurnDiagnostic?.(current.id, { boundary: 'silence', audioMs: 2000, trailingQuietMs: 700,
        recognitionLanguage: current.language, recognitionQueueMs: 0, recognitionInferenceMs: 12, commitToFinalMs: 20 });
      options.onEvent({ type: 'final', ...current }); current = undefined;
    }
    return { async connect() { gate(); }, audio(pcm) {
      assert.equal(pcm.byteLength, 2400); totalFrames++;
      if (quietFrames) { quietFrames--; if (quietFrames % 5 === 0) gate(); return; }
      frames++;
      if (frames % 40 === 1) {
        const language = mode === 'auto' ? (turn % 3 === 0 ? 'en' : 'ja') : mode === 'en-ja' ? 'en' : 'ja';
        current = { id: `synthetic-${stream}-${turn}`, text: language === 'en' ? 'Hello from the synthetic microphone.' : '合成マイクからこんにちは。', language };
        options.onEvent({ type: 'begin', id: current.id, sequence: turn++, mode });
      }
      if (frames % 40 === 5 && current) options.onEvent({ type: 'partial', id: current.id, text: current.text.slice(0, 4) });
      if (frames % 40 === 10) finalize();
    }, async finish() { finalize(); }, close() { closed++; },
    flush() { flushes++; finalize(); }, setMode(next) { finalize(); mode = next; modes.push(next); },
    calibrate() { calibrations++; current = undefined; quietFrames = 30; frames = 0; gate(); } };
  },
  translator: { async translate(input, _signal, diagnostic) {
    requests.push(input); diagnostic?.({ response: 'completed', outputTokenLimitReached: false });
    const source = input.mode === 'auto' ? input.sourceLanguage! : input.mode === 'en-ja' ? 'en' : 'ja';
    return source === 'en' ? { source, target: 'ja', text: '合成マイクからこんにちは。' }
      : { source: 'ja', target: 'en', text: 'Hello from the synthetic microphone.' };
  } },
});
const app = await createCaptionServer({ controller, port: 0, webDir: 'dist/web', configured: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.route('**/*', route => route.request().url().startsWith(app.origin + '/') ? route.continue() : route.abort());
  const errors: string[] = [];
  const control = await context.newPage(); control.on('pageerror', () => errors.push('control'));
  const overlay = await context.newPage(); overlay.on('pageerror', () => errors.push('overlay'));
  await overlay.addInitScript("Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => { throw new Error('Overlay attempted microphone capture'); } });");
  await control.goto(app.origin + '/control'); await overlay.goto(app.origin + '/overlay');
  assert.equal(await control.locator('#auto-gain').isChecked(), false);
  await control.locator('#diagnostic-log > summary').click();
  assert.equal(await control.locator('#diagnostic-indicator').textContent(), 'OFF');
  assert.equal(await control.locator('#diagnostic-download').isDisabled(), true);
  await control.getByRole('button', { name: 'Start diagnostics', exact: true }).click();
  assert.equal(await control.locator('#diagnostic-indicator').textContent(), 'ON');
  await control.locator('#diagnostic-log > summary').click();
  // Long fictional text can be browsed/tuned before any microphone or provider work.
  await control.getByRole('button', { name: 'Preview long conversation', exact: true }).click();
  assert.equal(await control.locator('#preview-notice').isVisible(), true);
  assert.equal(await control.locator('#captions article').count(), 8);
  assert(await control.locator('#captions').evaluate(node => node.scrollHeight > node.clientHeight));
  const previewIds = await control.locator('#captions article').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id));
  await control.locator('#history-search').fill('LECTURE');
  const matches = await control.locator('#captions article').count();
  assert(matches > 0 && matches < 8);
  await control.getByRole('button', { name: 'Clear search', exact: true }).click();
  assert.deepEqual(await control.locator('#captions article').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id)), previewIds);
  await control.locator('#history-search').fill('no matching fictional phrase');
  assert.equal(await control.locator('#captions article').count(), 0);
  assert.match(await control.locator('#captions').getAttribute('data-empty-message') ?? '', /No matching/);
  await control.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  assert.equal(await control.locator('#history-search').inputValue(), '');
  await control.locator('#reading-settings > summary').click();
  await control.locator('#translation-size').fill('18');
  await control.locator('#reading-spacing').selectOption('compact');
  await control.locator('#reading-width').selectOption('narrow');
  assert.equal(await control.locator('.translation').first().evaluate(node => getComputedStyle(node).fontSize), '18px');
  assert.equal(await control.locator('.original').first().evaluate(node => getComputedStyle(node).fontSize), '14px');
  assert.equal(await control.locator('main').evaluate(node => node.clientWidth), 860);
  await control.getByRole('button', { name: 'Reading focus', exact: true }).click();
  assert.equal(await control.locator('#reading-settings').isVisible(), true);
  await control.getByRole('button', { name: 'Exit reading focus', exact: true }).click();
  await control.locator('#reading-settings > summary').click();
  await control.getByRole('button', { name: 'Reset display', exact: true }).click();
  await control.locator('#captions').evaluate(node => {
    const row = node.children[3]!;
    node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top + 20;
  });
  await control.waitForTimeout(100);
  const readingAnchor = await control.locator('#captions').evaluate(node => {
    const row = [...node.children].find(child => child.getBoundingClientRect().bottom > node.getBoundingClientRect().top)!;
    return { id: (row as HTMLElement).dataset.id, offset: row.getBoundingClientRect().top - node.getBoundingClientRect().top };
  });
  await control.locator('#translation-size').fill('36');
  await control.locator('#reading-width').selectOption('narrow');
  const changedOffset = await control.locator(`[data-id="${readingAnchor.id}"]`).evaluate(node => node.getBoundingClientRect().top - node.parentElement!.getBoundingClientRect().top);
  assert(Math.abs(changedOffset - readingAnchor.offset) < 2, 'text resizing should preserve the visible turn and offset');
  assert.equal(await control.locator('#follow').isChecked(), false);
  await control.getByRole('button', { name: 'Reset display', exact: true }).click();
  await control.locator('#reading-settings > summary').click();
  await control.setViewportSize({ width: 390, height: 844 });
  assert(await control.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await control.locator('#captions').evaluate(node => node.clientHeight >= 178 && node.scrollHeight > node.clientHeight));
  await control.setViewportSize({ width: 1100, height: 800 });
  assert.equal(opened, 0); assert.equal(requests.length, 0);
  assert.equal(controller.snapshot().segments.length, 0);
  assert.equal(await overlay.locator('article').count(), 0);
  // Start automatically exits preview; fictional text must never become live context.
  await control.getByRole('button', { name: 'Start microphone' }).click();
  await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('ACTIVE'));
  await control.waitForFunction(() => document.getElementById('activity')!.textContent!.startsWith('Stay quiet'));
  assert.equal(await control.locator('#auto-gain').isDisabled(), true);
  assert.equal(await control.locator('#preview-notice').isVisible(), false);
  assert.equal(await control.locator('#layout-preview').isDisabled(), true);
  assert.equal(await control.locator('[data-id^="layout-preview-"]').count(), 0);
  await overlay.waitForSelector('.translation[lang="ja"]');
  assert.match(await control.locator('#capture-input').textContent() ?? '', /^Actual input:/);
  assert.equal(await control.locator('#gate-advice').isVisible(), true);
  assert(totalFrames >= 10);
  assert.equal(await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert(await overlay.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.translation')!).fontSize) > parseFloat(getComputedStyle(document.querySelector('.original')!).fontSize)));
  // Reading adjustments must not restart or interrupt an active microphone.
  const readingSession = controller.snapshot().sessionId;
  await control.locator('#reading-settings > summary').click();
  await control.locator('#translation-size').focus();
  await control.locator('#translation-size').press('ArrowRight');
  await control.locator('#translation-size').press('ArrowRight');
  await control.locator('#original-size').focus(); await control.locator('#original-size').press('ArrowRight');
  await control.locator('#reading-spacing').selectOption('roomy');
  await control.locator('#caption-details').check();
  assert.equal(await control.locator('.translation').first().evaluate(node => getComputedStyle(node).fontSize), '32px');
  assert.equal(await control.locator('.original').first().evaluate(node => getComputedStyle(node).fontSize), '20px');
  assert.match(await control.locator('#captions article[data-state="ready"] small').first().textContent() ?? '', /quiet boundary/);
  assert.equal(await overlay.locator('.translation').first().evaluate(node => getComputedStyle(node).fontSize), '40px');
  const settingsHeight = await control.locator('#captions').evaluate(node => node.clientHeight);
  await control.getByRole('button', { name: 'Reading focus', exact: true }).click();
  assert.equal(await control.locator('#pause').isEnabled(), true);
  assert.equal(await control.locator('#processing').isVisible(), true);
  assert.equal(await control.locator('#capture-input').isVisible(), true);
  assert.equal(await control.locator('#conversation').isVisible(), false);
  assert(await control.locator('#captions').evaluate(node => node.clientHeight) > settingsHeight);
  assert.equal(controller.snapshot().sessionId, readingSession); assert.equal(opened, 1); assert.equal(closed, 0);
  await control.getByRole('button', { name: 'Exit reading focus', exact: true }).click();
  await control.locator('#reading-settings > summary').click();
  await control.getByRole('button', { name: 'Reset display', exact: true }).click();
  assert.equal(await control.locator('.translation').first().evaluate(node => getComputedStyle(node).fontSize), '28px');
  assert.equal(await control.locator('#caption-details').isChecked(), false);
  await control.locator('#reading-settings > summary').click();
  await control.waitForFunction(() => document.querySelectorAll('#captions article[data-state="ready"]').length >= 6);
  assert.deepEqual(requests.slice(0, 3).map(r => [r.mode, r.sourceLanguage]), [['auto', 'en'], ['auto', 'ja'], ['auto', 'ja']]);
  assert(await control.locator('#captions .translation[lang="en"]').count() >= 2);
  assert.equal(opened, 1); assert.equal(closed, 0);
  // History is readable without forcing the user back to the newest caption.
  await control.locator('#follow').uncheck();
  await control.locator('#captions').evaluate(element => { element.scrollTop = 0; });
  await control.waitForTimeout(300);
  assert.equal(await control.locator('#follow').isChecked(), false);
  await control.getByRole('button', { name: 'Jump to latest' }).click();
  assert.equal(await control.locator('#follow').isChecked(), true);
  const session = controller.snapshot().sessionId;
  await control.getByRole('button', { name: 'Lecture · Japanese → English', exact: true }).click();
  await control.waitForFunction(() => document.querySelector('#lecture')?.getAttribute('aria-pressed') === 'true');
  assert.equal(controller.snapshot().mode, 'ja-en'); assert.equal(controller.snapshot().sessionId, session);
  assert.equal(opened, 1); assert.equal(closed, 0); assert.deepEqual(modes, ['ja-en']);
  await control.waitForFunction(() => document.getElementById('active-direction')!.textContent!.includes('Japanese recognition forced'));
  await control.locator('#diagnostic-log > summary').click();
  await control.getByRole('button', { name: 'Mark problem now', exact: true }).click();
  await control.locator('#diagnostic-log > summary').click();
  await control.getByRole('button', { name: 'Translate now', exact: true }).click();
  await control.waitForTimeout(100); assert.equal(flushes, 1);
  await control.getByRole('button', { name: 'Conversation · EN ↔ JA', exact: true }).click();
  await control.waitForFunction(() => document.querySelector('#conversation')?.getAttribute('aria-pressed') === 'true');
  assert.equal(controller.snapshot().mode, 'auto'); assert.equal(opened, 1);
  await control.locator('#diagnostics > summary').click();
  const beforeCalibration = controller.snapshot().generation;
  await control.getByRole('button', { name: 'Recalibrate room noise', exact: true }).click();
  await control.waitForFunction(() => document.getElementById('activity')!.textContent!.startsWith('Stay quiet'));
  assert.equal(calibrations, 1); assert.equal(opened, 1);
  assert(controller.snapshot().generation > beforeCalibration); assert.equal(controller.snapshot().segments.length, 0);
  await control.locator('#diagnostics > summary').click();
  await overlay.waitForSelector('.translation');
  const beforeReload = totalFrames;
  await overlay.reload(); await overlay.waitForSelector('.translation');
  await control.waitForTimeout(250); assert(totalFrames > beforeReload); assert.equal(opened, 1); assert.equal(closed, 0);
  await control.getByRole('button', { name: 'Clear screen' }).click();
  await control.waitForFunction(() => document.querySelectorAll('#captions article').length === 0);
  await overlay.waitForFunction(() => document.querySelectorAll('#captions article').length === 0);
  await overlay.waitForSelector('.translation'); assert.equal(opened, 2);
  await control.getByRole('button', { name: 'Pause', exact: true }).click();
  await control.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('PAUSED'));
  const stopped = totalFrames; await control.waitForTimeout(200); assert.equal(totalFrames, stopped);
  assert.match(await control.locator('#capture-input').textContent() ?? '', /microphone off/);
  // Heartbeats/health samples must not rewrite caption DOM or force reading-position layout work.
  await control.evaluate(() => {
    const state = window as unknown as { captionMutations: number; captionObserver: MutationObserver };
    state.captionMutations = 0;
    state.captionObserver = new MutationObserver(records => { state.captionMutations += records.length; });
    state.captionObserver.observe(document.getElementById('captions')!, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  await control.waitForTimeout(2200);
  assert.equal(await control.evaluate(() => {
    const state = window as unknown as { captionMutations: number; captionObserver: MutationObserver };
    state.captionObserver.disconnect(); return state.captionMutations;
  }), 0);
  await control.locator('#diagnostic-log > summary').click();
  await control.getByRole('button', { name: 'Stop diagnostics', exact: true }).click();
  const downloadEvent = control.waitForEvent('download');
  await control.getByRole('button', { name: 'Download diagnostics JSON', exact: true }).click();
  const diagnosticDownload = await downloadEvent;
  assert.match(diagnosticDownload.suggestedFilename(), /^captions-diagnostics-\d+\.json$/);
  const content = await diagnosticDownload.createReadStream();
  assert(content); const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.from(chunk));
  const json = Buffer.concat(chunks).toString('utf8'); const report = JSON.parse(json);
  assert.equal(report.collecting, false);
  assert.equal(report.version, 2); assert.equal(report.serviceTurnTelemetryObserved, true);
  assert(report.events.some((event: any) => event.type === 'turn' && event.turn.boundary === 'silence' && event.turn.recognitionInferenceMs === 12));
  assert(report.events.some((event: any) => event.type === 'turn' && event.turn.translationResponse === 'completed' && event.turn.contextSequences.length > 0));
  assert(report.events.some((event: any) => event.type === 'mark'));
  assert(report.events.some((event: any) => event.type === 'health' && event.health.mode === 'ja-en'));
  assert(report.events.some((event: any) => event.type === 'segment' && event.row.state === 'ready'));
  assert(report.events.some((event: any) => event.type === 'command' && event.command.type === 'pause'));
  assert(!json.includes('Hello from the synthetic microphone.'));
  assert(!json.includes('合成マイクからこんにちは。'));
  assert(!json.includes('layout-preview-')); assert(!json.includes('Synthetic smoke test'));
  assert(!json.includes(controller.snapshot().sessionId));
  assert.equal(await overlay.locator('#diagnostic-log').count(), 0);
  await control.getByRole('button', { name: 'Discard diagnostics', exact: true }).click();
  assert.equal(await control.locator('#diagnostic-download').isDisabled(), true);
  assert.equal(await control.locator('#diagnostic-indicator').textContent(), 'OFF');
  await control.locator('#diagnostic-log > summary').click();
  await control.locator('#diagnostics > summary').click();
  await control.getByRole('button', { name: 'New session' }).click();
  await overlay.waitForFunction(() => document.querySelectorAll('#captions article').length === 0);
  assert.deepEqual(errors, []);
  await control.close();
  // A denied microphone must fail visibly, not leave capture looking active.
  const denied = await context.newPage();
  await denied.addInitScript("Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });");
  await denied.goto(app.origin + '/control');
  await denied.getByRole('button', { name: 'Start microphone' }).click();
  await denied.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('FAILED'));
  assert.equal(controller.snapshot().error, 'capture');
  console.log('PASS: continuous EN/JA/JA conversation, lecture switch without capture restart, long fictional preview/search/order, reader sizing/width/scroll anchors, reading history, quiet calibration/recalibration, opt-in content-free diagnostic download, overlay reload, clear/pause and denied mic. Fake providers only; no paid calls or recordings.');
} finally { await browser?.close(); await app.close(); }
