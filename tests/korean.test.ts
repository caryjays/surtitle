import test from 'node:test';
import assert from 'node:assert/strict';
import { offeredPairs, pairTag, parsePairTag } from '../packages/protocol/index.ts';
import { rateLanguage, shownLength } from '../apps/web/pacer.ts';
import { uncaptionedLabel } from '../apps/web/client.ts';
import { previewLanguage, previewSegments } from '../apps/web/preview.ts';
import { attached } from '../packages/providers/script.ts';
import { harness, tick } from './helpers.ts';

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

test('a translation into Korean joins a particle to the number or Latin word before it, and nothing else', () => {
  assert.equal(attached('ko', 'RASP 는 2020 에 시작했고 매출의 10% 를 차지합니다.'), 'RASP는 2020에 시작했고 매출의 10%를 차지합니다.');
  assert.equal(attached('ko', 'Q1 의 성과, AI 와 LLM 을'), 'Q1의 성과, AI와 LLM을');
  // An ordinary word after a number or name keeps its space, and so does a counter, which may be written either way.
  for (const kept of ['COVID-19 때문에', '3 도시', '2 월과 3 월에', 'TV 보다 재미있다', '시장은 는 다릅니다']) assert.equal(attached('ko', kept), kept);
  // A reply still streaming may yet grow its last word.
  assert.equal(attached('ko', 'AI 는', true), 'AI 는');
  assert.equal(attached('ko', 'AI 는 좋', true), 'AI는 좋');
  // Other languages are untouched.
  assert.equal(attached('zh', 'AI 的'), 'AI 的'); assert.equal(attached('en', 'AI is'), 'AI is'); assert.equal(attached('unknown', 'AI 는'), 'AI 는');
});

test('the controller shows a Korean translation, streamed or final, with particles joined', async t => {
  const h = harness({ pair: ['en', 'ko'] }); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('a');
  h.requests[0]!.partial({ source: 'en', target: 'ko', text: 'AI 는 2020 에' });
  assert.equal(h.controller.snapshot().segments[0]!.translation, 'AI는 2020 에');
  h.requests[0]!.result.resolve({ source: 'en', target: 'ko', text: 'AI 는 2020 에 시작했습니다.' }); await tick();
  assert.deepEqual([h.controller.snapshot().segments[0]!.state, h.controller.snapshot().segments[0]!.translation], ['ready', 'AI는 2020에 시작했습니다.']);
});
