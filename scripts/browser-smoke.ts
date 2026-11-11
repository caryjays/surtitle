import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { Controller } from '../apps/service/controller.ts';
import { createCaptionServer } from '../apps/service/server.ts';
import { offeredPairs, type Mode, type TranslationInput } from '../packages/protocol/index.ts';

// Synthetic microphone + fake providers only. No .env, keys, retention, or paid calls.
let totalFrames = 0; let opened = 0; let closed = 0; let flushes = 0; let calibrations = 0;
const requests: TranslationInput[] = []; const modes: Mode[] = [];
const controller = new Controller({ pairs: offeredPairs(), backend: 'Synthetic smoke test', processing: 'local-audio-cloud-text', glossary: [], sessionLimitMs: null, segmentation: 'turns',
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
  assert.equal(await control.locator('#auto-gain').isChecked(), true);
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
  assert(await control.locator('main').evaluate(node => node.clientWidth) <= 860);
  await control.getByRole('button', { name: 'Reading focus', exact: true }).click();
  assert.equal(await control.locator('#reading-settings').isVisible(), true);
  // Reading focus folds the operator sidebar away and the narrow column takes its full width.
  assert.equal(await control.locator('.sidebar').isVisible(), false);
  assert.equal(await control.locator('main').evaluate(node => node.clientWidth), 860);
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
  assert.match(await control.locator('#capture-input').textContent() ?? '', /^Actual input:.* · applied: echo cancellation .* · noise suppression .* · automatic gain /);
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
  // Console: the audience view mirrors the overlay, and the overlay settings build the Browser Source URL.
  await control.waitForSelector('#audience-roll .translation');
  assert.equal(await control.locator('#audience-roll .rest').evaluateAll(nodes => nodes.filter(n => n.textContent).length), 0);
  await control.locator('#overlay-panel > summary').click();
  await control.locator('#overlay-lines').selectOption('3');
  assert.equal(await control.locator('#overlay-url').inputValue(), `${app.origin}/overlay?lines=3`);
  await control.locator('#overlay-pace').uncheck();
  assert.equal(await control.locator('#overlay-url').inputValue(), `${app.origin}/overlay?lines=3&pace=off`);
  assert.equal(await control.locator('#audience .stage-captions').evaluate(node => getComputedStyle(node).getPropertyValue('--overlay-lines').trim()), '3');
  await control.locator('#overlay-lines').selectOption('4'); await control.locator('#overlay-pace').check();
  assert.equal(await control.locator('#overlay-url').inputValue(), `${app.origin}/overlay`);
  await control.locator('#overlay-panel > summary').click();
  // Segmentation is shown but locked while capturing; translation switches off and on without a restart.
  assert.equal(await control.locator('#segmentation').isVisible(), true);
  assert.equal(await control.locator('input[name="segmentation"][value="turns"]').isChecked(), true);
  assert.equal(await control.locator('input[name="segmentation"][value="rolling"]').isDisabled(), true);
  await control.locator('#translation-toggle').uncheck();
  await control.waitForFunction(() => document.getElementById('processing')!.textContent!.includes('Translation is OFF'));
  assert.equal(controller.snapshot().translation.enabled, false);
  await control.locator('#translation-toggle').check();
  await control.waitForFunction(() => document.getElementById('processing')!.textContent!.includes('paid cloud translation'));
  // Shortcuts act only outside text fields; destructive commands have none.
  await control.locator('#captions').focus();
  const flushed = flushes;
  await control.keyboard.press('t'); await control.waitForTimeout(100);
  assert.equal(flushes, flushed + 1);
  await control.locator('#history-search').focus(); await control.keyboard.press('t'); await control.waitForTimeout(100);
  assert.equal(flushes, flushed + 1); assert.equal(await control.locator('#history-search').inputValue(), 't');
  await control.locator('#history-search').fill(''); await control.locator('#captions').focus();
  await control.keyboard.press('2');
  await control.waitForFunction(() => document.querySelector('#lecture')?.getAttribute('aria-pressed') === 'true');
  await control.keyboard.press('1');
  await control.waitForFunction(() => document.querySelector('#conversation')?.getAttribute('aria-pressed') === 'true');
  assert.equal(controller.snapshot().mode, 'auto'); assert.equal(opened, 1);
  await control.keyboard.press('?');
  assert.equal(await control.locator('#shortcuts').isVisible(), true);
  await control.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await control.locator('#shortcuts').isVisible(), false);
  await control.locator('#health-panel > summary').click();
  assert.match(await control.locator('#health').textContent() ?? '', /Captureactive/);
  await control.locator('#health-panel > summary').click();
  assert.equal(await control.locator('#state-pill').textContent(), 'ACTIVE');
  await control.locator('#diagnostics > summary').click();
  const beforeCalibration = controller.snapshot();
  await control.getByRole('button', { name: 'Recalibrate room noise', exact: true }).click();
  await control.waitForFunction(() => document.getElementById('activity')!.textContent!.startsWith('Stay quiet'));
  assert.equal(calibrations, 1); assert.equal(opened, 1);
  assert.equal(controller.snapshot().generation, beforeCalibration.generation);
  assert.deepEqual(controller.snapshot().segments.map(row => row.id), beforeCalibration.segments.filter(row => row.final).map(row => row.id));
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
  // Paused, segmentation can change; it applies at the next Start.
  await control.locator('input[name="segmentation"][value="rolling"]').check();
  for (let i = 0; i < 50 && controller.snapshot().segmentation !== 'rolling'; i++) await control.waitForTimeout(20);
  assert.equal(controller.snapshot().segmentation, 'rolling');
  assert.equal(await control.locator('#state-pill').textContent(), 'PAUSED');
  await control.locator('input[name="segmentation"][value="turns"]').check();
  // Paced text finishes releasing; after that, heartbeats/health samples must not rewrite caption DOM or force reading-position layout work.
  await control.waitForFunction(() => [...document.querySelectorAll('#captions .rest')].every(node => !node.textContent));
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
  const captured = report.events.find((event: any) => event.type === 'capture');
  assert(captured && Object.keys(captured.settings).sort().join() === 'autoGainControl,channelCount,echoCancellation,noiseSuppression,sampleRate');
  for (const stage of ['original-all', 'translation-first', 'translation-all']) assert(report.events.some((event: any) => event.type === 'display' && event.stage === stage), stage);
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
  // The overlay window follows the translation being read: short rows that arrive while a long translation is still being
  // released wait below the window instead of pushing it out. Snapshots here come from a mocked socket, not the service.
  const rollup = await context.newPage(); rollup.on('pageerror', () => errors.push('rollup'));
  let feed: { send(message: string): void } | undefined;
  await rollup.routeWebSocket(/\/ws\/overlay$/, socket => { feed = socket; });
  await rollup.setViewportSize({ width: 1920, height: 1080 });
  await rollup.goto(app.origin + '/overlay');
  for (let i = 0; i < 100 && !feed; i++) await rollup.waitForTimeout(20);
  assert(feed);
  const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');
  const base = controller.snapshot();
  const rollRow = (sequence: number, original: string, translation: string | null) => ({ id: `roll-${sequence}`, sequence, original, final: true,
    translation, source: 'ja', target: 'en', state: translation ? 'ready' : 'pending', finalizedAt: Date.now(), translationMs: translation ? 5 : null });
  const send = (generation: number, segments: unknown[]) => feed!.send(JSON.stringify({ ...base, generation, capture: 'active',
    translation: { available: true, enabled: true }, segments, turns: [], sentAt: Date.now() }));
  send(1, [rollRow(0, words(30), null)]);
  await rollup.waitForSelector('article[data-id="roll-0"]');
  send(1, [rollRow(0, words(30), words(60)), rollRow(1, 'Left.', null), rollRow(2, 'Or right.', null), rollRow(3, 'Left or right.', null)]);
  await rollup.waitForFunction(() => document.querySelector('article[data-id="roll-3"][data-waiting]'));
  await rollup.waitForTimeout(400);
  const reading = await rollup.evaluate(() => {
    const frame = document.getElementById('captions')!.getBoundingClientRect();
    const text = document.querySelector('article[data-id="roll-0"] .translation')!.getBoundingClientRect();
    return { inside: text.bottom <= frame.bottom + 1 && text.bottom - 40 >= frame.top, released: document.querySelector('article[data-id="roll-0"] .translation')!.textContent!.length,
      waiting: [...document.querySelectorAll<HTMLElement>('article[data-waiting]')].map(node => node.dataset.id) };
  });
  assert(reading.inside, 'the translation being released stays in the window');
  assert(reading.released > 0 && reading.released < words(60).length, 'the translation is still being released');
  assert(reading.waiting.includes('roll-3'));
  // Once nothing is left to release, the window returns to its bottom anchor and every row shows.
  send(2, [rollRow(0, words(30), words(60)), rollRow(1, 'Left.', 'L'), rollRow(2, 'Or right.', 'R'), rollRow(3, 'Left or right.', 'LR')]);
  await rollup.waitForFunction(() => document.querySelectorAll('article').length === 4 && !document.querySelector('article[data-waiting]'));
  await rollup.waitForTimeout(400);
  assert(await rollup.evaluate(() => {
    const frame = document.getElementById('captions')!.getBoundingClientRect();
    return Math.abs(document.querySelector('article[data-id="roll-3"]')!.getBoundingClientRect().bottom - frame.bottom) <= 1;
  }));
  await rollup.close();
  assert.deepEqual(errors, []);
  await control.close();
  // A denied microphone must fail visibly, not leave capture looking active.
  const denied = await context.newPage();
  await denied.addInitScript("Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });");
  await denied.goto(app.origin + '/control');
  await denied.getByRole('button', { name: 'Start microphone' }).click();
  await denied.waitForFunction(() => document.getElementById('status')!.textContent!.startsWith('FAILED'));
  assert.equal(controller.snapshot().error, 'capture');
  // With capture off, the pair selector switches the session's pair and the page relabels itself; and back.
  // The page that owns control now; a second control tab would be disconnected.
  const pairs = denied; const pairErrors: string[] = []; pairs.on('pageerror', () => pairErrors.push('control'));
  await pairs.waitForFunction(() => !(document.getElementById('pair') as HTMLSelectElement).disabled && !document.getElementById('pair-row')!.hidden);
  await pairs.locator('#pair').selectOption('en-es');
  await pairs.waitForFunction(() => document.querySelector('.brand h1')!.textContent === 'English ↔ Spanish');
  assert.equal(await pairs.locator('#lecture').textContent(), 'Lecture · Spanish → English');
  assert.deepEqual(await pairs.locator('#mode option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['auto', 'en-es', 'es-en']);
  assert.deepEqual(controller.snapshot().pair, ['en', 'es']);
  await pairs.locator('#pair').selectOption('en-ja');
  await pairs.waitForFunction(() => document.querySelector('.brand h1')!.textContent === 'English ↔ Japanese');
  assert.deepEqual(controller.snapshot().pair, ['en', 'ja']);
  assert.deepEqual(pairErrors, []);
  console.log('PASS: continuous EN/JA/JA conversation, lecture switch without capture restart, long fictional preview/search/order, reader sizing/width/scroll anchors, reading history, quiet calibration/recalibration, opt-in content-free diagnostic download, overlay reload, clear/pause and denied mic. Fake providers only; no paid calls or recordings.');
} finally { await browser?.close(); await app.close(); }
