import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_READING, READING_KEY, loadReading, readingPreferences, saveReading } from '../apps/web/reading.ts';

test('reader defaults are smaller and originals stay smaller than translations', () => {
  assert.deepEqual(loadReading(), DEFAULT_READING);
  assert.equal(DEFAULT_READING.translationSize, 28); assert.equal(DEFAULT_READING.originalSize, 18);
  assert.equal(readingPreferences({ ...DEFAULT_READING, originalSize: 26, translationSize: 22 }).originalSize, 18);
  assert.equal(DEFAULT_READING.originalSize, 18);
});
test('reader settings validate numeric limits, enums and unknown fields', () => {
  for (const value of [null, {}, { ...DEFAULT_READING, translationSize: '40' }, { ...DEFAULT_READING, originalSize: 100 },
    { ...DEFAULT_READING, translationSize: 23 }, { ...DEFAULT_READING, spacing: 'injected-css' }, { ...DEFAULT_READING, width: 'injected-css' },
    { ...DEFAULT_READING, transcript: 'must not persist' }]) {
    assert.deepEqual(readingPreferences(value), DEFAULT_READING);
  }
});
test('validated reader preferences restore independently of captions', () => {
  const preferences = { ...DEFAULT_READING, translationSize: 36, originalSize: 22, spacing: 'roomy' as const };
  assert.deepEqual(loadReading({ getItem(key) { assert.equal(key, READING_KEY); return JSON.stringify(preferences); } }), preferences);
});
test('older saved settings retain sizes and gain the default reading width', () => {
  const { width, ...older } = { ...DEFAULT_READING, translationSize: 36 };
  assert.deepEqual(readingPreferences(older), { ...older, width });
  assert.equal(readingPreferences({ ...DEFAULT_READING, translationSize: 18, originalSize: 32 }).originalSize, 14);
  assert.equal(readingPreferences({ ...DEFAULT_READING, translationSize: 48, originalSize: 32 }).originalSize, 32);
});
test('malformed or blocked browser storage does not break the reader', () => {
  assert.deepEqual(loadReading({ getItem() { return '{invalid'; } }), DEFAULT_READING);
  assert.deepEqual(loadReading({ getItem() { throw new Error('storage disabled'); } }), DEFAULT_READING);
  assert.doesNotThrow(() => saveReading(DEFAULT_READING, { setItem() { throw new Error('storage full'); } }));
});
test('only a bounded whitelist of display preferences is written to browser storage', () => {
  let saved = '';
  saveReading({ ...DEFAULT_READING, translationSize: 32 }, { setItem(key, value) { assert.equal(key, READING_KEY); saved = value; } });
  assert.deepEqual(JSON.parse(saved), { ...DEFAULT_READING, translationSize: 32 });
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['details', 'originalSize', 'spacing', 'translationSize', 'width']);
});
