import assert from 'node:assert/strict';
import test from 'node:test';
import { shownRow, uncaptionedLabel } from '../apps/web/client.ts';
import type { Segment } from '../packages/protocol/index.ts';

const row = (extra: Partial<Segment>): Segment => ({ id: 'r', sequence: 0, original: '', final: true, translation: null,
  source: 'unknown', target: 'unknown', state: 'original', finalizedAt: 0, translationMs: null, ...extra });

test('a marker reads the same in both pair languages and never names the speech language', () => {
  assert.equal(uncaptionedLabel(['en', 'ja']), '[ not captioned · 字幕なし ]');
  assert.equal(uncaptionedLabel(['ja', 'en']), '[ 字幕なし · not captioned ]');
});
test('the audience sees markers for speech outside the pair; the operator also sees filtered speech', () => {
  assert.equal(shownRow(row({ uncaptioned: 'language' }), false), true);
  assert.equal(shownRow(row({ uncaptioned: 'filtered' }), false), false);
  assert.equal(shownRow(row({ uncaptioned: 'filtered' }), true), true);
  assert.equal(shownRow(row({}), false), false);
  assert.equal(shownRow(row({ original: 'Hello' }), false), true);
});
