import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { LocalTranscriber, localTranscriberFactory, type LocalOptions } from '../packages/providers/local.ts';
import { Controller } from '../apps/service/controller.ts';
import { agreedRest, agreedTail, endsSentence, isStockPhrase, joinText, lockCount, stablePrefix, tailAfterAgreed } from '../packages/providers/rolling.ts';
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
  assert.deepEqual(lockCount(segments, 'One. Two.', 4300, false), { count: 1, forced: false }); // Two ends only 0.3 s before the newest audio
  assert.deepEqual(lockCount(segments, 'One. Two.', 4800, false), { count: 2, forced: false });
  assert.deepEqual(lockCount(segments, 'One. Two.', 4800, false, 1000), { count: 1, forced: false }); // a longer settle
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
    // Each partial reports the row's locked audio, which only grows, and its language, for piece translation.
    const audio = partials.map(p => p.locked!.audioMs);
    assert(audio[0]! > 0 && audio.every((ms, i) => i === 0 || ms >= audio[i - 1]!) && partials.every(p => p.locked!.language === 'ja'));
    // begin precedes the row's first text; nothing follows its final.
    const at = f.events.indexOf(row);
    assert(f.events.slice(at + 1).every(e => e.id !== row.id));
  }
  // The unlocked tail travels with the locked text for the operator's view.
  assert(f.events.some(e => e.type === 'partial' && e.stable! < e.text.length));
  const diagnostics = rows.map(r => f.measurements.find(m => m.id === r.id && m.value.boundary)!.value);
  assert.deepEqual(diagnostics.map(d => d.boundary), ['length', 'silence']);
  assert.equal(diagnostics[0]!.audioMs, 8000);
  // Voiced test frames hold 6000 of 32768; the row that closes at the quiet boundary also heard the trailing quiet.
  assert(Math.abs(diagnostics[0]!.inputRms! - 0.183) < 0.002 && Math.abs(diagnostics[0]!.inputPeak! - 0.183) < 0.002);
  assert(diagnostics[1]!.inputRms! < diagnostics[0]!.inputRms! && diagnostics[1]!.inputRms! > 0.1);
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
test('in Auto, decodes outside the pair lock nothing; three in a row leave one marker while the speech goes on', async t => {
  const f = fixture('rolling-third', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(3);
  // The marker closes during the speech, not at its end.
  assert.deepEqual(finals(f.events).map(r => [r.text, r.rejected, r.uncaptioned]), [['', true, 'language']]);
  await f.speak(5); f.quiet(); await f.stream.finish();
  assert(!f.events.some(e => e.type === 'partial' && e.text), 'no text displayed');
  // The rest of the stretch closes rejected without a second marker.
  assert.deepEqual(finals(f.events).map(r => [r.text, r.rejected, r.uncaptioned]), [['', true, 'language'], ['', true, undefined]]);
  const drops = f.measurements.flatMap(m => m.value.quality ? [m.value.quality.otherLanguageDrops ?? 0] : []);
  // Every decode came back outside the pair with text, and none of it locked.
  assert.equal(drops.reduce((a, b) => a + b, 0), f.requests.length);
});
test('a short stretch outside the pair leaves its marker when it closes', async t => {
  const f = fixture('rolling-third', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(2); f.quiet(); await f.stream.finish();
  assert.deepEqual(finals(f.events).map(r => [r.text, r.rejected, r.uncaptioned]), [['', true, 'language']]);
});
test('speech the filters reject leaves a filtered marker; non-speech leaves none', async t => {
  const f = fixture('rolling-filtered'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(2); f.quiet(); await f.stream.finish();
  assert.deepEqual(finals(f.events).map(r => [r.text, r.rejected, r.uncaptioned]), [['', true, 'filtered']]);
  const g = fixture('rolling-noise'); t.after(() => g.stream.close()); await g.stream.connect();
  await g.speak(2); g.quiet(); await g.stream.finish();
  assert.deepEqual(finals(g.events).map(r => [r.text, r.rejected, r.uncaptioned]), [['', true, undefined]]);
});
test('in Auto, an opening detected outside the pair is decoded again, not lost, once detection finds the pair', async t => {
  const f = fixture('rolling-third-opening', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.equal(rows[0]!.language, 'ja');
  assert(rows[0]!.text.startsWith('w0 w20'), rows[0]!.text);
  const dropped = f.measurements.find(m => m.value.quality)!.value.quality!.otherLanguageDrops!;
  assert(dropped >= 1 && dropped < f.requests.length, String(dropped));
});
test('one wholly filtered decode inside unlocked speech is skipped, not trimmed', async t => {
  const f = fixture('rolling-loop'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(7); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.equal(rows.length, 1);
  assert(rows[0]!.text.startsWith('w0 w20'), rows[0]!.text);
  assert.equal(f.failures(), 0);
});
test('in Auto, text outside the pair between two decodes that agree stops them locking', async t => {
  const f = fixture('rolling-alternate', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6.5);
  assert(!f.events.some(e => e.type === 'partial' && e.text), 'no text displayed');
  f.quiet(); await f.stream.finish();
});
test('in Auto, a switch of language inside a row without a pause closes the row and the stretch relearns its language', async t => {
  const f = fixture('rolling-switch', { mode: 'auto' }); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(16); f.quiet(); await f.stream.finish();
  const rows = finals(f.events);
  assert.deepEqual(rows.map(r => r.language), ['ja', 'en']);
  assert.equal(rows[0]!.text, words(0, 5));
  assert(rows[1]!.text.startsWith('e') && rows[1]!.text.endsWith('e300'), rows[1]!.text);
  assert.deepEqual(f.measurements.filter(m => m.value.boundary).map(m => m.value.boundary), ['length', 'silence']);
});
test('an agreed tail survives a lock and a wavering decode, and gives way to a longer agreement', () => {
  assert.equal(agreedRest('So here we have two', 'So, here we'), 'have two');
  assert.equal(agreedRest('So here we have two', 'And here'), '');
  assert.equal(agreedTail('have two photographs', 'Have two'), 'have two photographs'); // less speech agreed: what shows stays
  assert.equal(agreedTail('have two', 'have to photograph'), 'have to photograph'); // more speech agreed: it replaces
  assert.equal(tailAfterAgreed('have two', 'Have two, photographs on'), 'have two, photographs on');
  assert.equal(tailAfterAgreed('have two', 'half a'), 'have two');
  assert.equal(tailAfterAgreed('', 'anything'), 'anything');
});
test('text three decodes agree on is reported before its segment locks, and a row can begin with it', async t => {
  const f = fixture('rolling-long'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6);
  const partials = f.events.filter(e => e.type === 'partial') as Extract<TranscriptEvent, { type: 'partial' }>[];
  assert.equal(f.events[0]!.type, 'begin');
  assert(partials.length >= 2 && partials.every(p => p.stable === 0), 'nothing has locked');
  const agreed = partials.map(p => p.text.slice(0, p.agreed ?? 0));
  for (let i = 1; i < agreed.length; i++) assert(agreed[i]!.startsWith(agreed[i - 1]!), 'agreed text shrank');
  assert.equal(agreed.at(-1), words(0, 3)); // two decodes agree on four words, three on three
  assert(partials.at(-1)!.text.length > agreed.at(-1)!.length, 'the newest word is in the tail, not agreed');
  f.quiet(); await f.stream.finish();
  assert(finals(f.events)[0]!.text.startsWith(words(0, 4)));
  assert.equal(f.measurements.find(m => m.value.boundary)!.value.boundary, 'silence');
});
test('before a row has locked text, agreed text from a low-confidence decode is not reported', async t => {
  const f = fixture('rolling-long-faint'); t.after(() => f.stream.close()); await f.stream.connect();
  await f.speak(6);
  assert.equal(f.events.length, 0);
  f.quiet(); await f.stream.finish();
  assert.deepEqual(f.events.map(e => e.type), ['begin', 'final']);
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

// The real adapter and controller over the fake rolling worker. Voiced frames carry their index, so a word names its audio.
function session(t: { after(fn: () => void): void }, mode: 'ja-en' | 'en-ja', calibrationMs?: number) {
  const inputs: Parameters<Translator['translate']>[0][] = [];
  const controller = new Controller({ glossary: [], backend: 'Fake providers',
    transcriber: localTranscriberFactory({ model: 'small-q4', segmentation: 'rolling', ...(calibrationMs ? { calibrationMs } : {}),
      workerFactory: () => spawn(process.execPath, ['tests/fixtures/fake-local-worker.mjs', 'rolling'], { stdio: ['pipe', 'pipe', 'pipe'], env: {} }) }),
    translator: { async translate(input) {
      inputs.push(input);
      return input.sourceLanguage === 'ja' ? { source: 'ja', target: 'en', text: `T ${input.text}` } : { source: 'en', target: 'ja', text: `T ${input.text}` };
    } } });
  t.after(() => controller.dispose());
  let index = 0;
  const frames = (count: number, voiced: boolean) => {
    for (let i = 0; i < count; i++) {
      const pcm = Buffer.alloc(2400);
      if (voiced) { for (let j = 0; j < 2400; j += 2) pcm.writeInt16LE(6000, j); pcm.writeInt16LE(index, 0); }
      index++; controller.audio(pcm);
    }
  };
  const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
  return { controller, inputs, wait, start: () => controller.start(mode), index: () => index,
    quiet: (count = 30) => frames(count, false),
    // Without a wait, the first decode is still in flight when this returns and no text has locked.
    voiced: (seconds: number) => frames(20 * seconds, true),
    async speak(seconds: number) { for (let s = 0; s < seconds; s++) { frames(20, true); await wait(); } },
    rows: () => Snapshot.parse(controller.snapshot()).segments };
}
const indexes = (text: string) => [...text.matchAll(/w(\d+)/g)].map(match => Number(match[1]));

test('recalibrating before the first lock drops the old speech: no late row, no translation', async t => {
  const s = session(t, 'ja-en', 1500); await s.start();
  s.quiet(); s.voiced(1);
  s.controller.calibrate();
  await s.wait(80);
  const snapshot = Snapshot.parse(s.controller.snapshot());
  assert.deepEqual(snapshot.segments, []); assert.deepEqual(snapshot.turns, []);
  assert.equal(snapshot.rejected, 0); assert.equal(snapshot.capture, 'active');
  assert.equal(s.inputs.length, 0);
  // Speech after the new calibration is recognized and translated as usual, from its own audio only.
  s.quiet(); const from = s.index();
  await s.speak(3); s.quiet(14); await s.controller.pause(); await s.wait(20);
  assert.equal(s.rows().length, 1); assert.equal(s.rows()[0]!.state, 'ready');
  assert(indexes(s.rows()[0]!.original).length > 0 && indexes(s.rows()[0]!.original).every(i => i >= from), s.rows()[0]!.original);
  assert.deepEqual(s.inputs.map(input => input.text), [s.rows()[0]!.original]);
});
test('recalibrating an open row with locked text removes it, and its later decodes do not bring it back', async t => {
  const s = session(t, 'ja-en', 1500); await s.start();
  s.quiet(); await s.speak(4);
  assert(s.rows()[0]?.original, 'the row shows locked text before recalibration');
  s.voiced(1); s.controller.calibrate();
  await s.wait(80);
  assert.deepEqual(s.rows(), []); assert.equal(s.inputs.length, 0);
  s.quiet(); const from = s.index();
  await s.speak(3); s.quiet(14); await s.controller.pause(); await s.wait(20);
  assert.equal(s.rows().length, 1);
  assert(indexes(s.rows()[0]!.original).every(i => i >= from), s.rows()[0]!.original);
  assert.equal(s.inputs.length, 1);
});
test('a direction change before the first lock leaves the old speech its own direction', async t => {
  const s = session(t, 'ja-en'); await s.start();
  s.voiced(1);
  s.controller.setMode('en-ja');
  await s.wait(80);
  assert.deepEqual(s.inputs.map(input => [input.mode, input.sourceLanguage]), [['ja-en', 'ja']]);
  assert.deepEqual(s.rows().map(row => [row.source, row.target, row.state]), [['ja', 'en', 'ready']]);
  await s.speak(3); s.quiet(14); await s.controller.pause(); await s.wait(20);
  assert.deepEqual(s.inputs.map(input => [input.mode, input.sourceLanguage]), [['ja-en', 'ja'], ['en-ja', 'en']]);
  assert.deepEqual(s.rows().map(row => [row.source, row.target, row.state]), [['ja', 'en', 'ready'], ['en', 'ja', 'ready']]);
  assert.deepEqual(Snapshot.parse(s.controller.snapshot()).turns.map(turn => turn.mode), ['ja-en', 'en-ja']);
});
test('a rolling row begins with the mode it was heard in, and recalibration ends its events', async t => {
  const f = fixture('rolling', { calibrationMs: 1500 }); t.after(() => f.stream.close()); await f.stream.connect();
  const calibration = () => { for (let i = 0; i < 30; i++) f.stream.audio(Buffer.alloc(2400)); };
  calibration(); f.push(1); f.stream.setMode('en-ja'); await f.stream.finish();
  assert.deepEqual(f.events.map(e => [e.type, e.type === 'begin' ? e.mode : null]), [['begin', 'ja-en'], ['final', null]]);
  f.push(1); f.stream.calibrate();
  await new Promise(r => setTimeout(r, 80));
  assert.equal(f.events.length, 2);
  calibration(); await f.speak(3); f.quiet(); await f.stream.finish();
  assert.deepEqual(f.events.slice(2).filter(e => e.type !== 'partial').map(e => [e.type, e.type === 'begin' ? e.mode : null]), [['begin', 'en-ja'], ['final', null]]);
  assert.equal(f.failures(), 0);
});
