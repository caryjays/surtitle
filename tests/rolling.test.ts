import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { LocalTranscriber, localTranscriberFactory, type LocalOptions } from '../packages/providers/local.ts';
import { Controller } from '../apps/service/controller.ts';
import { endsSentence, isStockPhrase, joinText, lockCount, stablePrefix } from '../packages/providers/rolling.ts';
import { Snapshot, type TurnMeasurement } from '../packages/protocol/index.ts';
import type { TranscriptEvent, Translator } from '../packages/providers/types.ts';

test('stable text is the agreed prefix and never ends inside a Latin word', () => {
  assert.equal(stablePrefix('Hello world', 'Hello words'), 'Hello ');
  assert.equal(stablePrefix('version 12', 'version 123'), 'version ');
  assert.equal(stablePrefix('今日は晴れ', '今日は雨'), '今日は');
  assert.equal(stablePrefix('', 'anything'), '');
});
test('only whole segments inside the stable text that have settled lock, unless forced or final', () => {
  const segments = [{ endMs: 2000, text: ' One.' }, { endMs: 4000, text: ' Two.' }, { endMs: 5500, text: ' Thr' }];
  assert.deepEqual(lockCount(segments, 'One. Two.', 4800, false), { count: 1, forced: false }); // Two ends only 0.8 s before the newest audio
  assert.deepEqual(lockCount(segments, 'One. Two.', 6000, false), { count: 2, forced: false });
  assert.deepEqual(lockCount(segments, 'One. Tw', 6000, false), { count: 1, forced: false });
  assert.deepEqual(lockCount(segments, '', 24_000, false), { count: 0, forced: false });
  assert.deepEqual(lockCount(segments, '', 25_000, false), { count: 2, forced: true });
  assert.deepEqual(lockCount([{ endMs: 25_000, text: ' long' }], '', 25_000, false), { count: 1, forced: true });
  assert.deepEqual(lockCount(segments, '', 6000, true), { count: 3, forced: false });
});
test('row text joins segments without gluing Latin words and detects sentence ends', () => {
  assert.equal(joinText('', ' Hello.'), 'Hello.');
  assert.equal(joinText('Hello.', ' World'), 'Hello. World');
  assert.equal(joinText('Hello.', 'World'), 'Hello. World');
  assert.equal(joinText('今日は', '晴れです。'), '今日は晴れです。');
  const ends = '.!?。！？';
  assert(endsSentence('It works.', ends) && endsSentence('そうです。」', ends) && !endsSentence('and then', ends));
  assert(!endsSentence('そうです。', '.!?') && endsSentence('a-b]', ']-'));
});
test('stock sign-offs match only when they are the whole text', () => {
  assert(isStockPhrase('ご視聴ありがとうございました。'));
  assert(isStockPhrase('Thank you for watching!'));
  assert(!isStockPhrase('皆さんお疲れ様でした、次の話題です'));
  assert(!isStockPhrase(''));
});

// Frames carry their absolute index in the first sample; see tests/fixtures/fake-local-worker.mjs.
function fixture(behavior: string, extra: Partial<ConstructorParameters<typeof LocalTranscriber>[0]> = {}) {
  const events: TranscriptEvent[] = []; const measurements: { id: string; value: TurnMeasurement }[] = [];
  const requests: number[] = []; let replies = 0; let failures = 0; let index = 0;
  const stream = new LocalTranscriber({ model: 'small-q4', mode: 'ja-en', segmentation: 'rolling',
    workerFactory: () => {
      const child = spawn(process.execPath, ['tests/fixtures/fake-local-worker.mjs', behavior], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = ((line: string) => {
        requests.push(Buffer.from(JSON.parse(line).audio, 'base64').length / 48);
        // Backpressure: never a second request before the previous reply.
        assert.equal(requests.length - replies, 1);
        return write(line);
      }) as typeof child.stdin.write;
      child.stdout.on('data', (chunk: Buffer) => { replies += chunk.toString().split('"type":"final"').length - 1; });
      return child;
    },
    onEvent: event => events.push(event), onFailure: () => { failures++; },
    onTurnDiagnostic: (id, value) => measurements.push({ id, value }), ...extra });
  const frame = (voiced: boolean) => {
    const pcm = Buffer.alloc(2400);
    if (voiced) for (let i = 0; i < 2400; i += 2) pcm.writeInt16LE(6000, i);
    pcm.writeInt16LE(index++, 0);
    return pcm;
  };
  const idle = async () => {
    for (let i = 0; i < 400; i++) { if (replies >= requests.length) return; await new Promise(r => setTimeout(r, 5)); }
    assert.fail('worker reply timed out');
  };
  return {
    stream, events, measurements, requests, failures: () => failures,
    async speak(seconds: number) {
      for (let s = 0; s < seconds; s++) { this.push(1); await idle(); }
    },
    push(seconds: number) { for (let i = 0; i < 20 * seconds; i++) stream.audio(frame(true)); },
    quiet() { for (let i = 0; i < 14; i++) stream.audio(frame(false)); },
  };
}
const finals = (events: TranscriptEvent[]) => events.filter(e => e.type === 'final') as Extract<TranscriptEvent, { type: 'final' }>[];
const words = (from: number, count: number) => Array.from({ length: count }, (_, k) => `w${from + 20 * k}`).join(' ');

test('rolling locks agreed words, never retracts them, closes rows by length and locks everything at the end', async t => {
  const f = fixture('rolling'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(12); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.deepEqual(rows.map(r => r.text), [words(0, 8), words(160, 4)]);
  assert.deepEqual(rows.map(r => r.language), ['ja', 'ja']);
  for (const row of rows) {
    const partials = f.events.filter(e => e.type === 'partial' && e.id === row.id) as Extract<TranscriptEvent, { type: 'partial' }>[];
    const locked = partials.map(p => p.text.slice(0, p.stable));
    assert(partials.length > 1 && partials.every(p => p.stable !== undefined && p.stable > 0));
    for (let i = 1; i < locked.length; i++) assert(locked[i]!.startsWith(locked[i - 1]!), 'locked text retracted');
    assert(row.text.startsWith(locked.at(-1)!));
    // begin precedes the row's first text; nothing follows its final.
    const at = f.events.indexOf(row);
    assert(f.events.slice(at + 1).every(e => e.id !== row.id));
  }
  // The unlocked tail travels with the locked text for the operator's view.
  assert(f.events.some(e => e.type === 'partial' && e.stable! < e.text.length));
  const diagnostics = rows.map(r => f.measurements.find(m => m.id === r.id && m.value.boundary)!.value);
  assert.deepEqual(diagnostics.map(d => d.boundary), ['length', 'silence']);
  assert.equal(diagnostics[0]!.audioMs, 8000);
  assert(diagnostics.every(d => d.decodes! > 0 && d.forcedLocks === 0 && d.firstTextMs !== undefined && d.lockLagMs !== undefined));
  // Locked audio is trimmed, so no request grows past a few seconds in agreeing speech.
  assert(Math.max(...f.requests) <= 3000);
  assert.equal(f.failures(), 0);
});
test('rolling rows can close at a clause or a shorter length, and report speech end to final', async t => {
  const clauses = fixture('rolling-clauses', { rows: { sentenceMs: 3000, maxMs: 8000, clauseMs: 1500 } });
  t.after(() => clauses.stream.close()); await clauses.stream.connect();
  await clauses.speak(8); clauses.quiet(); await clauses.stream.finish();
  const rows = finals(clauses.events);
  assert.deepEqual(rows.slice(0, 3).map(r => r.text), ['w0 w20、', 'w40 w60、', 'w80 w100、']);
  const closing = (f: typeof clauses) => finals(f.events).map(r => f.measurements.find(m => m.id === r.id && m.value.boundary)!.value);
  assert.deepEqual(closing(clauses).slice(0, 3).map(d => [d.boundary, d.audioMs]), [['length', 2000], ['length', 2000], ['length', 2000]]);
  assert(closing(clauses).every(d => d.speechEndToFinalMs !== undefined));
  const short = fixture('rolling', { rows: { sentenceMs: 3000, maxMs: 4000, clauseMs: null } });
  t.after(() => short.stream.close()); await short.stream.connect();
  await short.speak(9); short.quiet(); await short.stream.finish();
  assert.deepEqual(closing(short).map(d => [d.boundary, d.audioMs]).slice(0, 2), [['length', 4000], ['length', 4000]]);
  // Without a clause length, clause punctuation does not close a row.
  const live = fixture('rolling-clauses'); t.after(() => live.stream.close()); await live.stream.connect();
  await live.speak(6); live.quiet(); await live.stream.finish();
  assert.equal(finals(live.events).length, 1);
});
test('rolling forces a lock rather than let an unagreeing window approach Whisper input', async t => {
  const f = fixture('rolling-unstable'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(27); f.quiet(); await f.stream.finish();
  const forced = f.measurements.map(m => m.value.forcedLocks ?? 0).reduce((a, b) => a + b, 0);
  assert(forced >= 1);
  assert(Math.max(...f.requests) <= 26_000);
  assert(finals(f.events).length >= 2);
  assert.equal(f.failures(), 0);
});
test('rolling trims a window that held no speech and reports the stretch as rejected', async t => {
  const f = fixture('rolling-noise'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(10); f.quiet(); await f.stream.finish();
  assert(Math.max(...f.requests) <= 4000);
  assert.deepEqual(f.events.map(e => e.type), ['begin', 'final']);
  assert.equal(finals(f.events)[0]!.rejected, true);
});
test('in Auto a row takes its language from a decode with accepted text, not from a misheard filtered opening', async t => {
  const f = fixture('rolling-misheard', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.equal(rows[0]!.language, 'ja');
  assert(rows[0]!.text.startsWith('w0 w20'), rows[0]!.text);
});
test('in Auto a short opening misheard as accepted text does not settle the row; the language of the first locked text does', async t => {
  const f = fixture('rolling-misheard-pass', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.equal(rows[0]!.language, 'ja');
  assert(rows[0]!.text.startsWith('w0 w20'), rows[0]!.text);
});
test('one wholly filtered decode inside unlocked speech is skipped, not trimmed', async t => {
  const f = fixture('rolling-loop'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(7); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.equal(rows.length, 1);
  assert(rows[0]!.text.startsWith('w0 w20'), rows[0]!.text);
  assert.equal(f.failures(), 0);
});
test('after a noise trim, two low-confidence decodes that agree do not lock, even in the closing decode', async t => {
  const f = fixture('rolling-after-noise-hallucination'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(12); f.quiet(); await f.stream.finish();
  assert(!f.events.some(e => e.type === 'partial' && e.text), 'no text displayed');
  assert.deepEqual(finals(f.events).map(r => [r.text, r.rejected]), [['', true]]);
});
test('after a noise trim, confident decodes that agree lock as usual', async t => {
  const f = fixture('rolling-after-noise-speech'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(12); f.quiet(); await f.stream.finish();
  assert(finals(f.events)[0]!.text.startsWith('Period.'), finals(f.events)[0]!.text);
});
test('a decode in flight when its stretch closes is ignored; the closing decode alone finalizes', async t => {
  const f = fixture('rolling'); t.after(() => f.stream.close()); await f.stream.connect();
  f.push(1); // the first request is in flight now
  f.quiet(); await f.stream.finish();
  assert.deepEqual(f.events.map(e => e.type), ['begin', 'final']);
  assert.equal(finals(f.events)[0]!.text, 'w0');
});
test('a direction change closes the stretch with its old language and the next uses the new one', async t => {
  const f = fixture('rolling'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(3); f.stream.setMode('en-ja'); await f.speak(2); f.quiet(); await f.stream.finish();
  assert.deepEqual(finals(f.events).map(r => r.language), ['ja', 'en']);
  assert.deepEqual(f.measurements.filter(m => m.value.boundary).map(m => m.value.boundary), ['mode-change', 'silence']);
});
test('closing the stream mid-stretch drops in-flight work without later events', async t => {
  const f = fixture('rolling'); await f.stream.connect();
  await f.speak(3); for (let i = 0; i < 20; i++) f.stream.audio(Buffer.alloc(2400, 1));
  const count = f.events.length; f.stream.close();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(f.events.length, count); assert.equal(f.failures(), 0);
  t.after(() => f.stream.close());
});
test('through the controller, rolling rows show locked text while open and are translated once each, at final', async t => {
  const inputs: Parameters<Translator['translate']>[0][] = [];
  const shown: string[] = [];
  const controller = new Controller({ glossary: [], backend: 'Fake providers',
    transcriber: localTranscriberFactory({ model: 'small-q4', segmentation: 'rolling',
      workerFactory: () => spawn(process.execPath, ['tests/fixtures/fake-local-worker.mjs', 'rolling'], { stdio: ['pipe', 'pipe', 'pipe'], env: {} }) }),
    translator: { async translate(input) { inputs.push(input); return { source: 'ja', target: 'en', text: `T ${input.text}` }; } } });
  t.after(() => controller.dispose());
  await controller.start('ja-en');
  let index = 0;
  const second = () => {
    for (let i = 0; i < 20; i++) {
      const pcm = Buffer.alloc(2400); for (let j = 0; j < 2400; j += 2) pcm.writeInt16LE(6000, j); pcm.writeInt16LE(index++, 0);
      controller.audio(pcm);
    }
  };
  for (let s = 0; s < 10; s++) {
    second(); await new Promise(r => setTimeout(r, 40));
    const open = Snapshot.parse(controller.snapshot()).segments.filter(row => !row.final);
    if (open[0]?.original) shown.push(open[0].original);
  }
  for (let i = 0; i < 14; i++) controller.audio(Buffer.alloc(2400));
  await controller.pause();
  await new Promise(r => setTimeout(r, 20));
  const rows = Snapshot.parse(controller.snapshot()).segments;
  assert.deepEqual(rows.map(row => [row.original, row.translation, row.state]),
    [[words(0, 8), `T ${words(0, 8)}`, 'ready'], [words(160, 2), `T ${words(160, 2)}`, 'ready']]);
  assert.deepEqual(inputs.map(input => input.text), [words(0, 8), words(160, 2)]);
  assert(inputs.every(input => !input.truncated?.start && !input.truncated?.end));
  assert(shown.length > 3 && shown.every(text => !/t\d/.test(text)), 'only locked text is shown while a row is open');
});
