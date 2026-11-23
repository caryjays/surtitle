import test from 'node:test';
import assert from 'node:assert/strict';
import { offeredPairs, pairTag, parsePairTag } from '../packages/protocol/index.ts';
import { rateLanguage, shownLength } from '../apps/web/pacer.ts';
import { uncaptionedLabel } from '../apps/web/client.ts';
import { previewLanguage, previewSegments } from '../apps/web/preview.ts';

test('Korean pairs with English without a script, and is offered on the operator page', () => {
  assert.deepEqual(parsePairTag('en-ko'), { pair: ['en', 'ko'], script: null });
  assert(offeredPairs().some(choice => pairTag(choice) === 'en-ko'));
  assert.equal(uncaptionedLabel(['en', 'ko']), '[ not captioned · 자막 없음 ]');
});

test('Korean is paced at its own rates and released in whole words', () => {
  assert.equal(rateLanguage('그래서 오늘은', 'unknown', ['en', 'ko']), 'ko');
  assert.equal(rateLanguage('So today', 'unknown', ['en', 'ko']), 'en');
  assert.equal(shownLength('그래서 오늘은 이야기를', 6, 'ko'), 3);
});

test('the layout preview pairs English with a Korean conversation', () => {
  assert.equal(previewLanguage(['en', 'ko']), 'ko');
  const rows = previewSegments(['en', 'ko']);
  assert.equal(rows.length, 8);
  assert(rows.every(row => /[\p{Script=Hangul}]/u.test(row.source === 'ko' ? row.original : row.translation!)));
});
