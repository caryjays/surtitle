import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PACE, Pacer, rateLanguage, shownLength, type ShownRow } from '../apps/web/pacer.ts';
import type { Segment, Snapshot } from '../packages/protocol/index.ts';

const SESSION = '00000000-0000-4000-8000-000000000000';
function row(id: string, original: string, extra: Partial<Segment> = {}): Segment {
  return { id, sequence: Number(id.replace(/\D/g, '')) || 0, original, final: true, translation: null, source: 'en', target: 'ja',
    state: 'original', finalizedAt: 0, translationMs: null, ...extra };
}
function snapshot(segments: Segment[], generation = 0, sessionId = SESSION) {
  return { sessionId, generation, pair: ['en', 'ja'], segments } as unknown as Snapshot;
}
// Steps a pacer at 100 ms ticks, returning what it shows after each.
function run(pacer: Pacer, state: () => Snapshot, from: number, ms: number) {
  const frames: { at: number; rows: ShownRow[] }[] = [];
  for (let at = from; at <= from + ms; at += 100) frames.push({ at, rows: pacer.update(state(), at) });
  return frames;
}
const sentence = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('text present when a session or connection starts is shown at once; new text is released at a steady pace', () => {
  const pacer = new Pacer();
  const history = row('r1', sentence(10));
  assert.equal(pacer.update(snapshot([history]), 0)[0]!.original, history.original);
  const fresh = row('r2', sentence(16)); // 16 words, 94 characters: drained over about 4 s at the 25/s ceiling
  const frames = run(pacer, () => snapshot([history, fresh]), 100, 6000);
  const shown = frames.map(f => f.rows[1]!.original.length);
  for (let i = 1; i < shown.length; i++) {
    assert(shown[i]! >= shown[i - 1]!, 'released text shrank');
    // Never faster than the ceiling, allowing one word of rounding.
    assert(shown[i]! - shown[i - 1]! <= 25 * 0.1 + 7, `burst of ${shown[i]! - shown[i - 1]!}`);
  }
  const done = frames.find(f => f.rows[1]!.original === fresh.original)!.at;
  assert(done >= 3000 && done <= 5000, `drained at ${done} ms`);
  assert.equal(frames.at(-1)!.rows[0]!.original, history.original);
  assert(frames.every(f => f.rows[1]!.original === '' || fresh.original.startsWith(f.rows[1]!.original)));
});

test('English is released in whole words and Japanese by character at its own rates', () => {
  assert.equal(shownLength('hello world again', 8, 'en'), 5);
  assert.equal(shownLength('hello world again', 11, 'en'), 11);
  assert.equal(shownLength('hello', 3, 'en'), 0);
  assert.equal(shownLength('今日は晴れです', 3.7, 'ja'), 3);
  assert.equal(rateLanguage('今日は', 'unknown', ['en', 'ja']), 'ja');
  assert.equal(rateLanguage('Hello', 'unknown', ['en', 'ja']), 'en');
  const pacer = new Pacer();
  pacer.update(snapshot([]), 0);
  const japanese = row('r1', '今日は晴れです。明日は雨が降るでしょう。', { source: 'ja', target: 'en' }); // 20 characters
  const frames = run(pacer, () => snapshot([japanese]), 100, 8000);
  const at = (ms: number) => frames.find(f => f.at === ms)!.rows[0]!.original.length;
  // 20 characters over a 4 s drain is 5/s, inside Japanese's 3 to 10.
  assert(at(1100) >= 3 && at(1100) <= 7, String(at(1100)));
  assert.equal(at(5100), 20);
});

test('only locked text is released; the unlocked tail and unreleased text stay in the rest, and locked text is never rewritten', () => {
  const pacer = new Pacer();
  pacer.update(snapshot([]), 0);
  // A rolling row grows: locked prefix plus a tail that later decodes change.
  const steps = [
    { text: 'one two three four', stable: 7 },
    { text: 'one two three fore five', stable: 13 },
    { text: 'one two three four five six', stable: 23 },
  ];
  let current = steps[0]!;
  const shown: string[] = [];
  for (let at = 100; at <= 9000; at += 100) {
    if (at === 3000) current = steps[1]!;
    if (at === 6000) current = steps[2]!;
    const [r] = pacer.update(snapshot([row('r1', current.text, { final: false, state: 'partial', stable: current.stable, finalizedAt: null })]), at);
    assert(r!.original.length <= current.stable, 'released text beyond the locked prefix');
    assert.equal(r!.original + r!.originalRest, current.text);
    shown.push(r!.original);
  }
  for (let i = 1; i < shown.length; i++) assert(shown[i]!.startsWith(shown[i - 1]!), `rewrote ${shown[i - 1]} as ${shown[i]}`);
  assert.equal(shown.at(-1), 'one two three four five');
});

test('a large backlog speeds release gradually instead of jumping', () => {
  const pacer = new Pacer();
  pacer.update(snapshot([]), 0);
  const long = row('r1', sentence(110)); // about 650 characters, 26 s at the ceiling, past the 10 s catch-up limit
  const frames = run(pacer, () => snapshot([long]), 100, 30_000);
  const second = (s: number) => frames.find(f => f.at === s * 1000 + 100)!.rows[0]!.original.length;
  const perSecond = Array.from({ length: 12 }, (_, s) => second(s + 1) - second(s));
  assert(perSecond[0]! <= 25 + 7, `first second ${perSecond[0]}`);
  assert(perSecond[8]! > perSecond[0]! + 10, `no catch-up: ${perSecond.join(',')}`);
  for (let s = 1; s < perSecond.length; s++) assert(perSecond[s]! - perSecond[s - 1]! <= 25, `jump: ${perSecond.join(',')}`);
  const done = frames.find(f => f.rows[0]!.original === long.original)?.at;
  assert(done !== undefined && done < 26_000, `drained at ${done}`);
});

test('originals and translations are separate lanes, each paced in its own language', () => {
  const pacer = new Pacer();
  const first = row('r1', 'Hello there.', { translation: null, state: 'pending' });
  pacer.update(snapshot([first]), 0);
  const translated = { ...first, translation: 'こんにちは、皆さん。今日はよろしくお願いします。', state: 'ready' as const };
  const frames = run(pacer, () => snapshot([translated]), 100, 6000);
  assert.equal(frames[0]!.rows[0]!.original, 'Hello there.');
  const lengths = frames.map(f => f.rows[0]!.translation?.length ?? 0);
  assert(lengths[10]! > 0 && lengths[10]! <= 10, String(lengths[10]));
  assert.equal(frames.at(-1)!.rows[0]!.translation, translated.translation);
  assert.equal(frames[10]!.rows[0]!.translation! + frames[10]!.rows[0]!.translationRest, translated.translation);
});

test('a cleared display or a new session drops released state, and new rows start from nothing', () => {
  const pacer = new Pacer();
  pacer.update(snapshot([]), 0);
  run(pacer, () => snapshot([row('r1', sentence(20))]), 100, 1000);
  assert.deepEqual(pacer.update(snapshot([], 1), 1200), []);
  const after = pacer.update(snapshot([row('r2', sentence(5))], 1), 1300)[0]!;
  assert.equal(after.original, '');
  assert.equal(after.originalRest, sentence(5));
  // A new session shows what it already holds, as a reconnect does.
  assert.equal(pacer.update(snapshot([row('r3', 'Already here.')], 0, '11111111-1111-4111-8111-111111111111'), 1400)[0]!.original, 'Already here.');
  // Losing the connection forgets everything.
  assert.deepEqual(pacer.update(undefined, 1500), []);
});

test('with pacing off, locked text shows at once and the tail still does not', () => {
  const pacer = new Pacer({ ...DEFAULT_PACE, enabled: false });
  pacer.update(snapshot([]), 0);
  const [r] = pacer.update(snapshot([row('r1', 'one two three', { final: false, state: 'partial', stable: 7, finalizedAt: null })]), 100);
  assert.equal(r!.original, 'one two');
  assert.equal(r!.originalRest, ' three');
});

test('the audience window follows the earliest row whose translation is still owed, and keeps its text inside', async () => {
  const { readingRow, rollShift } = await import('../apps/web/audience.ts');
  const shown = (id: string, state: Segment['state'], translationRest = ''): ShownRow => ({ ...row(id, 'text', { state }), originalRest: '', translationRest });
  assert.equal(readingRow([shown('r1', 'ready'), shown('r2', 'ready', 'rest'), shown('r3', 'pending')])!.id, 'r2');
  assert.equal(readingRow([shown('r1', 'ready'), shown('r2', 'pending'), shown('r3', 'ready', 'rest')])!.id, 'r2');
  // Translation off, failed rows and an open row hold nothing back.
  assert.equal(readingRow([shown('r1', 'original'), shown('r2', 'failed'), shown('r3', 'partial')]), undefined);
  assert.equal(rollShift(0, 112, 272), 0); // the newest text: bottom anchored
  assert.equal(rollShift(100, 112, 272), 0); // still fits above later rows
  assert.equal(rollShift(250, 112, 272), 90); // later rows would push it out: the roll moves down by the overlap
  assert.equal(rollShift(250, 400, 272), 250); // taller than the window: its end stays in view
});

test('a display set to show text early releases agreed text beyond the locked prefix; others never do', () => {
  const partial = (original: string, stable: number, agreed?: number) => snapshot([row('r1', 'history'), row('r2', original,
    { final: false, state: 'partial', stable, finalizedAt: null, ...(agreed === undefined ? {} : { agreed }) })]);
  const early = new Pacer({ ...DEFAULT_PACE, enabled: false, early: true }); const locked = new Pacer({ ...DEFAULT_PACE, enabled: false });
  for (const pacer of [early, locked]) pacer.update(snapshot([row('r1', 'history')]), 0);
  assert.equal(early.update(partial('one two three four', 3, 13), 100)[1]!.original, 'one two three');
  assert.equal(locked.update(partial('one two three four', 3, 13), 100)[1]!.original, 'one');
  // Agreed text that changes is shown as it now stands; a row without agreed text falls back to its locked prefix.
  assert.equal(early.update(partial('one two tree for', 3, 12), 200)[1]!.original, 'one two tree');
  assert.equal(early.update(partial('one two tree for', 7), 300)[1]!.original, 'one two');
});
