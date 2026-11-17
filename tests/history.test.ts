import test from 'node:test';
import assert from 'node:assert/strict';
import { filterHistory, PREVIEW_SEGMENTS, readingContentChanged } from '../apps/web/history.ts';
import { MAX_SEGMENTS, PROFILES, Segment, TurnTrace } from '../packages/protocol/index.ts';
import { previewLanguage, previewSegments } from '../apps/web/preview.ts';

test('fictional preview is bounded, bilingual and includes long multi-paragraph turns', () => {
  assert(PREVIEW_SEGMENTS.length <= MAX_SEGMENTS);
  for (const row of PREVIEW_SEGMENTS) assert(Segment.safeParse(row).success);
  assert.equal(new Set(PREVIEW_SEGMENTS.map(row => row.id)).size, PREVIEW_SEGMENTS.length);
  assert(PREVIEW_SEGMENTS.some(row => row.original.includes('\n\n')));
  assert(PREVIEW_SEGMENTS.some(row => row.original.length > 300));
  assert.deepEqual([...new Set(PREVIEW_SEGMENTS.map(row => row.source))].sort(), ['en', 'ja']);
});
test('the preview is in the session pair for every profiled language, and in English and Japanese otherwise', () => {
  for (const other of Object.keys(PROFILES).filter(language => language !== 'en')) {
    const rows = previewSegments(['en', other]);
    assert.equal(previewLanguage(['en', other]), other);
    assert.equal(rows.length, PREVIEW_SEGMENTS.length);
    for (const row of rows) assert(Segment.safeParse(row).success);
    assert.deepEqual([...new Set(rows.map(row => row.source))].sort(), ['en', other].sort());
    assert(rows.every(row => row.target === (row.source === 'en' ? other : 'en') && row.original && row.translation));
    assert(rows.some(row => row.original.includes('\n\n')));
    assert(filterHistory(rows, 'lecture').some(row => row.source === 'en'));
    // The search word the preview suggests finds the pair language's own turns.
    const word = rows.find(row => row.source === 'en' && row.original.includes('Try searching'))!.original.match(/or “(.+?)”/)![1]!;
    assert(filterHistory(rows, word).some(row => row.source === other));
  }
  assert.equal(previewLanguage(['en', 'de']), 'ja');
  assert.deepEqual(previewSegments(['ja', 'en']), PREVIEW_SEGMENTS);
});
test('history search matches either language, normalizes case/width and preserves order', () => {
  const english = filterHistory(PREVIEW_SEGMENTS, '  LECTURE  ');
  assert(english.some(row => row.source === 'en'));
  assert(english.some(row => row.source === 'ja'));
  assert.deepEqual(filterHistory(PREVIEW_SEGMENTS, 'ＬＥＣＴＵＲＥ'), english);
  assert(filterHistory(PREVIEW_SEGMENTS, '日本語').length > 0);
  assert.deepEqual(filterHistory(PREVIEW_SEGMENTS, 'not in any fixture'), []);
  assert.deepEqual(filterHistory(PREVIEW_SEGMENTS, '   '), PREVIEW_SEGMENTS);
  assert.deepEqual(english.map(row => row.sequence), english.map(row => row.sequence).sort((a, b) => a - b));
});
test('health-only snapshots skip history DOM/layout work while actual caption/boundary changes render', () => {
  const before = { segments: PREVIEW_SEGMENTS, turns: [TurnTrace.parse({ sequence: 0, mode: 'auto', outcome: 'ready', boundary: 'silence', audioMs: 2000 })] };
  assert.equal(readingContentChanged(undefined, before), true);
  const copied = structuredClone(before);
  for (let i = 0; i < 100; i++) assert.equal(readingContentChanged(before, copied), false);
  assert.equal(readingContentChanged(before, { ...copied, turns: [{ ...copied.turns[0]!, recognitionQueueMs: 30 }] }), false);
  assert.equal(readingContentChanged(before, { ...copied, turns: [{ ...copied.turns[0]!, boundary: 'max-duration' }] }), true);
  assert.equal(readingContentChanged(before, { ...copied, turns: [{ ...copied.turns[0]!, audioMs: 3000 }] }), true);
  assert.equal(readingContentChanged(before, { ...copied, segments: [{ ...copied.segments[0]!, original: 'A changed preview' }, ...copied.segments.slice(1)] }), true);
  assert.equal(readingContentChanged(before, { ...copied, segments: [{ ...copied.segments[0]!, translation: 'A revised translation' }, ...copied.segments.slice(1)] }), true);
  assert.equal(readingContentChanged(before, { ...copied, segments: copied.segments.slice(1) }), true);
});
test('search does not mutate source history or require a translation', () => {
  const original = { ...PREVIEW_SEGMENTS[0]!, translation: null };
  assert.deepEqual(filterHistory([original], 'companion'), [original]);
  assert.equal(original.translation, null);
  assert.deepEqual(filterHistory([{ ...original, original: '' }], ''), []);
});
