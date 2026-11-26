import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TermSet, offeredPairs } from '../packages/protocol/index.ts';
import { projectTerms, termMisses } from '../packages/providers/terms.ts';
import { EXAMPLE_GLOSSARY, loadGlossary } from '../apps/service/glossary.ts';
import { harness, tick } from './helpers.ts';

const demo = TermSet.parse({ name: 'Demo', terms: [
  { name: 'Claude Code', heard: ['cloud code', 'クロードコード', 'cloud'] },
  { name: 'Acme', ja: 'アクメ' },
  { en: 'inference', ja: '推論', ko: '추론', zh: '推理', 'zh-Hant': '推論' },
  { en: 'pull request', es: 'solicitud de incorporación' },
] });

test('a term set entry is a name, or a term with forms in two profiled languages', () => {
  const bad = (term: unknown) => assert.equal(TermSet.safeParse({ name: 'x', terms: [term] }).success, false);
  bad({ en: 'alone' }); bad({ en: 'word', xx: 'no profile' }); bad({ en: 'word', 'ja-Hant': 'no such script' });
  bad({ en: 'word', ja: '語', heard: ['wurd'] }); bad({ name: 'N', heard: ['x'] }); bad({ zh: '推理', 'zh-Hant': '推論' });
  assert.equal(TermSet.safeParse({ name: 'x', terms: Array.from({ length: 33 }, () => ({ name: 'N' })) }).success, false);
});

test('a pair sends names as written and only terms with a form in both its languages', () => {
  const ja = projectTerms(demo, ['en', 'ja']);
  assert.deepEqual(ja.glossary, [{ term: 'Claude Code', translation: 'Claude Code' }, { term: 'Acme', translation: 'アクメ' }, { term: 'inference', translation: '推論' }]);
  assert.deepEqual(ja.gaps, ['pull request']);
  const es = projectTerms(demo, ['en', 'es']);
  assert.deepEqual(es.glossary, [{ term: 'Claude Code', translation: 'Claude Code' }, { term: 'Acme', translation: 'Acme' }, { term: 'pull request', translation: 'solicitud de incorporación' }]);
  assert.deepEqual(es.gaps, ['inference']);
});

test('a Chinese form is sent in the session script, a form written for that script first', () => {
  assert.equal(projectTerms(demo, ['en', 'zh'], 'Hans').glossary[2]!.translation, '推理');
  assert.equal(projectTerms(demo, ['en', 'zh'], 'Hant').glossary[2]!.translation, '推論');
  const plain = TermSet.parse({ name: 'x', terms: [{ en: 'machine learning', zh: '机器学习' }] });
  assert.equal(projectTerms(plain, ['en', 'zh'], 'Hant').glossary[0]!.translation, '機器學習');
});

test('the list format that came before reads as English and Japanese, and sends the same list in en-ja', async () => {
  const list = [{ term: 'inference', translation: '推論' }, { term: 'Claude', translation: 'Claude' }];
  const set = TermSet.parse({ name: 'Old', terms: [{ en: 'inference', ja: '推論' }, { name: 'Claude' }] });
  assert.deepEqual(projectTerms(set, ['en', 'ja']).glossary, list);
  assert.deepEqual(projectTerms(set, ['en', 'ko']).glossary, [{ term: 'Claude', translation: 'Claude' }]);
});

test('the tracked example has a form for every offered pair, in that pair\'s writing', async () => {
  const example = await loadGlossary(EXAMPLE_GLOSSARY);
  assert.equal(TermSet.safeParse(JSON.parse(await readFile(EXAMPLE_GLOSSARY, 'utf8'))).success, true);
  for (const { pair, script } of offeredPairs()) {
    const { entries, gaps } = projectTerms(example, pair, script);
    assert.deepEqual(gaps, [], pair.join('-'));
    // No kana outside Japanese: a set must never send a third language to the translator.
    if (pair[1] !== 'ja') assert(entries.every(entry => !/[぀-ヿ]/.test(entry.translation)), pair.join('-'));
  }
});

test('heard spellings are replaced by the name: whole words in Latin writing, anywhere in other writing', () => {
  const { correct } = projectTerms(demo, ['en', 'ja']);
  assert(correct);
  assert.equal(correct('en', 'We use Cloud  Code, and cloud code. The cloudy sky, McCloud.'), 'We use Claude Code, and Claude Code. The cloudy sky, McCloud.');
  assert.equal(correct('en', 'Cloud storage'), 'Claude Code storage');
  assert.equal(correct('ja', 'クロードコードは便利です'), 'Claude Codeは便利です');
  assert.equal(projectTerms(TermSet.parse({ name: 'x', terms: [{ name: 'Acme' }] }), ['en', 'ja']).correct, undefined);
  // A name with a form for the recognized language is written in that form.
  const local = projectTerms(TermSet.parse({ name: 'x', terms: [{ name: 'Acme', ja: 'アクメ', heard: ['acne'] }] }), ['en', 'ja']).correct!;
  assert.equal(local('en', 'the acne suite'), 'the Acme suite'); assert.equal(local('ja', 'acneの製品'), 'アクメの製品');
});

test('misses count names not kept exactly and terms whose counterpart is absent, in either direction', () => {
  const { entries } = projectTerms(demo, ['en', 'ja']);
  assert.deepEqual(termMisses(entries, ['en', 'ja'], 'en', 'Claude Code runs inference.', 'Claude Codeは推論を実行します。'), { names: 1, nameMisses: 0, terms: 1, termMisses: 0 });
  assert.deepEqual(termMisses(entries, ['en', 'ja'], 'en', 'claude code runs inference.', 'クロードコードは推定します。'), { names: 1, nameMisses: 1, terms: 1, termMisses: 1 });
  assert.deepEqual(termMisses(entries, ['en', 'ja'], 'ja', 'アクメの推論', 'Acme Inference'), { names: 1, nameMisses: 0, terms: 1, termMisses: 0 });
  assert.deepEqual(termMisses(entries, ['en', 'ja'], 'unknown', 'Claude Code', ''), { names: 0, nameMisses: 0, terms: 0, termMisses: 0 });
});

test('a pair switch changes what requests carry; a set switch needs capture off and starts a new session', async () => {
  const none = TermSet.parse({ name: 'None', terms: [] });
  const h = harness({ termSets: [demo, none], pairs: [['en', 'ja'], ['en', 'ko']] });
  assert.deepEqual(h.controller.snapshot().glossary, { name: 'Demo', sets: ['Demo', 'None'], names: 2, terms: 1, gaps: ['pull request'] });
  await h.controller.start('auto');
  assert.equal(h.streams[0]!.correct!('en', 'cloud code'), 'Claude Code');
  h.final('a', 'Claude Code runs inference.');
  assert.deepEqual(h.requests[0]!.input.glossary.map(entry => entry.translation), ['Claude Code', 'アクメ', '推論']);
  h.requests[0]!.result.resolve({ source: 'en', target: 'ja', text: 'クロード・コードは推論を実行します。' }); await tick();
  const trace = h.controller.snapshot().turns[0]!;
  assert.deepEqual([trace.glossaryNames, trace.glossaryNameMisses, trace.glossaryTerms, trace.glossaryTermMisses], [1, 1, 1, 0]);
  // A heard spelling in a translation, streamed or final, is replaced by the name, and then counts as kept.
  h.final('a2', 'Open Claude Code.');  await tick();
  h.requests[1]!.partial({ source: 'en', target: 'ja', text: 'クロードコードを' });
  assert.equal(h.controller.snapshot().segments[1]!.translation, 'Claude Codeを');
  h.requests[1]!.result.resolve({ source: 'en', target: 'ja', text: 'クロードコードを開きます。' }); await tick();
  assert.equal(h.controller.snapshot().segments[1]!.translation, 'Claude Codeを開きます。');
  assert.deepEqual([h.controller.snapshot().turns[1]!.glossaryNames, h.controller.snapshot().turns[1]!.glossaryNameMisses], [1, 0]);
  const session = h.controller.snapshot().sessionId;
  h.controller.setGlossary('None');
  assert.equal(h.controller.snapshot().glossary!.name, 'Demo');
  await h.controller.pause(); h.controller.setPair(['en', 'ko']);
  assert.deepEqual(h.controller.snapshot().glossary, { name: 'Demo', sets: ['Demo', 'None'], names: 2, terms: 1, gaps: ['pull request'] });
  await h.controller.start('auto'); h.final('b', 'Inference.'); await tick();
  assert.deepEqual(h.requests[2]!.input.glossary, [{ term: 'Claude Code', translation: 'Claude Code' }, { term: 'Acme', translation: 'Acme' }, { term: 'inference', translation: '추론' }]);
  await h.controller.pause(); h.controller.setGlossary('None');
  const after = h.controller.snapshot();
  assert.deepEqual([after.glossary!.name, after.segments.length, after.sessionId !== session], ['None', 0, true]);
  await h.controller.start('auto'); h.final('c'); await tick();
  assert.deepEqual(h.requests[3]!.input.glossary, []); assert.equal(h.streams.at(-1)!.correct, undefined);
  assert.equal(h.controller.offersGlossary('Demo'), true); assert.equal(h.controller.offersGlossary('Other'), false);
  h.controller.dispose();
});
