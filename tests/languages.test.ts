import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { PROFILES, Snapshot, direction, modes, parsePair } from '../packages/protocol/index.ts';
import { translationInstructionsFor, translationSchemaFor } from '../packages/providers/translation.ts';
import { transcriptionConfig } from '../packages/providers/openai.ts';
import { createCaptionServer } from '../apps/service/server.ts';
import { harness, tick } from './helpers.ts';

test('a pair needs two distinct languages that both have profiles', () => {
  assert.deepEqual(parsePair('en-ja'), ['en', 'ja']);
  for (const bad of ['en-en', 'en-xx', 'EN-JA', 'en', 'en-ja-ko', '']) assert.throws(() => parsePair(bad), bad);
  assert.deepEqual(modes(['en', 'ja']), ['auto', 'en-ja', 'ja-en']);
  assert.deepEqual(direction('ja-en'), { source: 'ja', target: 'en' });
  assert.equal(direction('auto'), null);
  for (const profile of Object.values(PROFILES)) assert(profile.stockPhrases.length && profile.sentenceEnd);
});
test('translation instructions, schema and cloud recognition hints follow the pair', () => {
  const swapped = translationInstructionsFor(['ja', 'en']);
  assert.match(swapped, /Mode ja-en requires source ja and target en; en-ja requires source en and target ja/);
  assert.match(swapped, /dominant Japanese to English or dominant English to Japanese/);
  assert.deepEqual(translationSchemaFor(['en', 'ja']).properties.source.enum, ['en', 'ja', 'unknown']);
  const config = transcriptionConfig('model', 'auto', [], ['en', 'ja']).session.audio.input.transcription;
  assert.deepEqual(config.languages, ['en', 'ja']);
  assert.deepEqual(transcriptionConfig('model', 'ja-en', [], ['en', 'ja']).session.audio.input.transcription.languages, ['ja']);
});
test('the controller refuses modes outside its pair and treats other recognized languages as unknown', async () => {
  const h = harness({ pair: ['en', 'ja'] });
  assert.deepEqual(h.controller.snapshot().pair, ['en', 'ja']);
  await h.controller.start('en-ko');
  assert.equal(h.controller.snapshot().capture, 'paused');
  await h.controller.start('auto');
  h.controller.setMode('ko-en');
  assert.equal(h.controller.snapshot().mode, 'auto');
  h.begin('a'); h.streams[0]!.emit({ type: 'final', id: 'a', text: '안녕하세요', language: 'ko' });
  assert.equal(h.controller.snapshot().segments[0]!.source, 'unknown');
  assert.equal(h.controller.snapshot().turns[0]!.recognitionSource, 'unknown');
  assert.equal(h.requests[0]!.input.sourceLanguage, 'unknown');
  // An automatic translation into a language outside the pair fails the row; the original survives.
  h.requests[0]!.result.resolve({ source: 'ko', target: 'en', text: 'Hello' });
  await tick(); await tick();
  const row = h.controller.snapshot().segments[0]!;
  assert.equal(row.state, 'failed'); assert.equal(row.original, '안녕하세요'); assert.equal(row.translation, null);
  h.controller.dispose();
});
test('the server closes a control socket that sends a mode outside the pair', async t => {
  const h = harness(); const webDir = await mkdtemp(join(tmpdir(), 'captions-test-'));
  for (const name of ['control.html', 'overlay.html', 'control.js', 'overlay.js', 'worklet.js', 'style.css']) await writeFile(join(webDir, name), 'fixture');
  const app = await createCaptionServer({ controller: h.controller, port: 0, webDir, configured: true });
  t.after(async () => { await app.close(); await rm(webDir, { recursive: true, force: true }); });
  const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/ws/control', { origin: app.origin });
  const first = once(ws, 'message'); await once(ws, 'open');
  assert.deepEqual(Snapshot.parse(JSON.parse(String((await first)[0]))).pair, ['en', 'ja']);
  ws.send(JSON.stringify({ type: 'start', mode: 'en-fr' }));
  await once(ws, 'close');
  assert.equal(h.controller.snapshot().error, 'protocol'); assert.equal(h.streams.length, 0);
});
