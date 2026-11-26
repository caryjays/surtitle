import test from 'node:test';
import assert from 'node:assert/strict';
import { Snapshot, offeredPairs, pairTag, parsePairTag, profile } from '../packages/protocol/index.ts';
import { attached, inScript } from '../packages/providers/script.ts';
import { translationInstructionsFor } from '../packages/providers/translation.ts';
import { languageTag, uncaptionedLabel } from '../apps/web/client.ts';
import { previewSegments } from '../apps/web/preview.ts';
import { harness, tick } from './helpers.ts';

test('a pair tag names a script only for a language that has scripts, and defaults to its first', () => {
  assert.deepEqual(parsePairTag('en-ja'), { pair: ['en', 'ja'], script: null });
  assert.deepEqual(parsePairTag('en-zh'), { pair: ['en', 'zh'], script: 'Hans' });
  assert.deepEqual(parsePairTag('en-zh-Hant'), { pair: ['en', 'zh'], script: 'Hant' });
  assert.deepEqual(parsePairTag('zh-en-Hant'), { pair: ['zh', 'en'], script: 'Hant' });
  for (const bad of ['en-ja-Hant', 'en-zh-Latn', 'en-zh-hant', 'en-zh-Hant-TW', 'en-zh-', 'en']) assert.throws(() => parsePairTag(bad), bad);
  assert.equal(pairTag(parsePairTag('en-zh')), 'en-zh-Hans');
  assert.equal(pairTag(parsePairTag('en-es')), 'en-es');
  const offered = offeredPairs().map(pairTag);
  assert(offered.includes('en-zh-Hans') && offered.includes('en-zh-Hant') && offered.includes('en-ja') && !offered.includes('en-zh'));
});
test('a script names the language and labels its markers; other languages ignore it', () => {
  assert.equal(profile('zh').name, 'Simplified Chinese');
  assert.equal(profile('zh', 'Hant').name, 'Traditional Chinese (Taiwan)');
  assert.equal(profile('ja', 'Hant').name, 'Japanese');
  assert.match(translationInstructionsFor(['en', 'zh'], 'Hant'), /dominant English to Traditional Chinese \(Taiwan\) or dominant Traditional Chinese \(Taiwan\) to English/);
  assert.equal(uncaptionedLabel(['en', 'zh'], 'Hant'), '[ not captioned · 無字幕 ]');
  assert.equal(uncaptionedLabel(['en', 'zh']), '[ not captioned · 无字幕 ]');
  assert.deepEqual(['zh', 'en', 'ja', 'unknown'].map(language => languageTag(language, 'Hant')), ['zh-Hant', 'en', 'ja', '']);
  assert.equal(languageTag('zh', null), 'zh');
});
test('Chinese is converted to the session script from either script, and nothing else is touched', () => {
  assert.equal(inScript('zh', 'Hant', '这里的软件后来发展了'), '這裡的軟件後來發展了');
  // Hong Kong and OpenCC forms reach Taiwan's.
  assert.equal(inScript('zh', 'Hant', '這裏着重'), '這裡著重');
  assert.equal(inScript('zh', 'Hans', '這裡的軟件後來發展了'), '这里的软件后来发展了');
  assert.equal(inScript('zh', null, '後來'), '后来');
  assert.equal(inScript('zh', 'Hant', 'OpenAI GPT-5, 2026'), 'OpenAI GPT-5, 2026');
  // Kanji in Japanese, and text of no known language, stay as written.
  assert.equal(inScript('ja', 'Hans', 'ご視聴ありがとうございました'), 'ご視聴ありがとうございました');
  assert.equal(inScript('unknown', 'Hans', '後來'), '後來');
  // Converting twice changes nothing.
  for (const script of ['Hans', 'Hant'] as const) {
    const once = inScript('zh', script, '这里的軟件後來發展了，着重於头发');
    assert.equal(inScript('zh', script, once), once);
  }
});
test('translations into Chinese, streamed and final, show in the session script; English is untouched', async t => {
  const h = harness({ pair: ['en', 'zh'], script: 'Hant' }); t.after(() => h.controller.dispose());
  assert.equal(h.controller.snapshot().script, 'Hant');
  await h.controller.start('auto'); h.final('a', 'Here is the software');
  h.requests[0]!.partial({ source: 'en', target: 'zh', text: '这里' }); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.translation, '這裡');
  h.requests[0]!.result.resolve({ source: 'en', target: 'zh', text: '这里是软件' }); await tick();
  assert.equal(h.controller.snapshot().segments[0]!.translation, '這裡是軟件');
  h.final('b', '后来'); h.requests[1]!.result.resolve({ source: 'zh', target: 'en', text: 'Later' }); await tick();
  assert.equal(h.controller.snapshot().segments[1]!.translation, 'Later');
});
test('the operator switches between the two scripts as two pairs, each a new session', async t => {
  const h = harness({ pair: ['en', 'zh'], pairs: [['en', 'ja'], ...offeredPairs().filter(choice => choice.pair[1] === 'zh')] });
  t.after(() => h.controller.dispose());
  const first = Snapshot.parse(h.controller.snapshot());
  assert.deepEqual([first.script, first.pairs], ['Hans', ['en-ja', 'en-zh-Hans', 'en-zh-Hant']]);
  assert(h.controller.offers(['en', 'zh'], 'Hant') && h.controller.offers(['en', 'zh']) && !h.controller.offers(['en', 'ja'], 'Hant'));
  h.controller.setPair(['en', 'zh'], 'Hant');
  const after = Snapshot.parse(h.controller.snapshot());
  assert.deepEqual([after.pair, after.script, after.mode], [['en', 'zh'], 'Hant', 'auto']);
  assert.notEqual(after.sessionId, first.sessionId);
  assert.deepEqual(h.translatorPairs, [[['en', 'zh'], 'Hant']]);
  await h.controller.start('auto');
  assert.equal(h.streams.at(-1)!.script, 'Hant');
  await h.controller.pause();
  // A bare pair stands for its first script.
  h.controller.setPair(['en', 'zh']);
  assert.equal(h.controller.snapshot().script, 'Hans');
  h.controller.setPair(['en', 'ja']);
  assert.equal(h.controller.snapshot().script, null);
});
test('the Traditional preview conversation is the Simplified one as the service converts it', () => {
  const hans = previewSegments(['en', 'zh'], 'Hans'), hant = previewSegments(['en', 'zh'], 'Hant');
  assert.notDeepEqual(hans, hant);
  assert.deepEqual(hant, hans.map(row => ({ ...row,
    original: inScript(row.source, 'Hant', row.original), translation: inScript(row.target, 'Hant', row.translation ?? '') })));
});

test('a translation into Japanese closes the space between a Latin word or number and the Japanese beside it', () => {
  assert.equal(attached('ja', 'これは AI の話で、10 月と 11 月に Q3 の 30% を占めます。'), 'これはAIの話で、10月と11月にQ3の30%を占めます。');
  assert.equal(attached('ja', 'プラス 1 からプラス 1.5 程度、José さん'), 'プラス1からプラス1.5程度、Joséさん');
  // Japanese punctuation counts as Japanese. A space between two Latin words or numbers stays, and so does one between
  // two Japanese words or after a Latin comma.
  assert.equal(attached('ja', 'はい。 OK です。次は Open Markets の AFM 13 と 24 です'), 'はい。OKです。次はOpen MarketsのAFM 13と24です');
  for (const kept of ['Thank you, everyone.', '山田 太郎さん', 'Hello, 皆さん']) assert.equal(attached('ja', kept), kept);
  // A streamed reply needs no care: a space is closed only once both of its neighbours are written.
  assert.equal(attached('ja', '次は AI ', true), '次はAI ');
  // Chinese keeps its spaces, and text of no known language is untouched.
  assert.equal(attached('zh', 'AI 的 10 月'), 'AI 的 10 月'); assert.equal(attached('unknown', 'AI は'), 'AI は');
});
test('the controller shows a Japanese translation, streamed or final, with those spaces closed', async t => {
  const h = harness({ pair: ['en', 'ja'] }); t.after(() => h.controller.dispose()); await h.controller.start('auto');
  h.final('a');
  h.requests[0]!.partial({ source: 'en', target: 'ja', text: 'AI は 2020 ' });
  assert.equal(h.controller.snapshot().segments[0]!.translation, 'AIは2020 ');
  h.requests[0]!.result.resolve({ source: 'en', target: 'ja', text: 'AI は 2020 年に始まりました。' }); await tick();
  assert.deepEqual([h.controller.snapshot().segments[0]!.state, h.controller.snapshot().segments[0]!.translation], ['ready', 'AIは2020年に始まりました。']);
});
