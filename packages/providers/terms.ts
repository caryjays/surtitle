import type { Glossary, Language, Pair, Script, Term, TermSet } from '../protocol/index.ts';
import { inScript } from './script.ts';

// One entry as a session sends it: term in the pair's first language, translation in its second. A name is the same
// kind of mapping, usually to itself.
export type Entry = { term: string; translation: string; name: boolean };
export type Projection = {
  entries: Entry[];
  // What every translation request of the session carries.
  glossary: Glossary;
  // Terms left out because they have no form in one of the pair's languages, by their English or first form.
  gaps: string[];
  // Text in a language, recognized or translated, with each name's heard spellings replaced by the name; absent when
  // the set lists none.
  correct?: (language: string, text: string) => string;
};

// A term's form in a language: the one for the session's script when it has one, else the language's, in that script.
function form(term: Term, language: Language, script?: Script | null) {
  const found = (script ? term[`${language}-${script}`] : undefined) ?? term[language];
  return typeof found === 'string' ? inScript(language, script, found) : undefined;
}
const label = (term: Term) => Object.entries(term).find(([key, value]) => key === 'en' && typeof value === 'string')?.[1] as string | undefined
  ?? Object.entries(term).find(([key, value]) => key !== 'heard' && typeof value === 'string')![1] as string;

// A set as one pair uses it. Names always apply; a term applies when it has a form in both languages of the pair, so a
// set written for one pair never sends another pair's language to the translator.
export function projectTerms(set: TermSet, pair: Pair, script?: Script | null): Projection {
  const entries: Entry[] = [], gaps: string[] = [];
  const heard: { spelling: string; term: Term }[] = [];
  for (const term of set.terms) {
    const [a, b] = pair.map(language => form(term, language, script));
    if (term.name !== undefined) {
      entries.push({ term: a ?? term.name, translation: b ?? term.name, name: true });
      for (const spelling of term.heard ?? []) heard.push({ spelling, term });
    } else if (a !== undefined && b !== undefined) entries.push({ term: a, translation: b, name: false });
    else gaps.push(label(term));
  }
  // Longest first, so a spelling that contains another is replaced whole.
  heard.sort((x, y) => y.spelling.length - x.spelling.length);
  const patterns = heard.map(({ spelling, term }) => ({ pattern: phrase(spelling, 'giu'), term }));
  return {
    entries, glossary: entries.map(({ term, translation }) => ({ term, translation })), gaps,
    ...(patterns.length ? { correct: (language: string, text: string) => patterns.reduce((result, { pattern, term }) =>
      result.replace(pattern, () => form(term, language, script) ?? term.name!), text) } : {}),
  };
}
// A fixed list, as tests and replays give one: an entry mapped to itself counts as a name.
export function fixedTerms(glossary: Glossary): Projection {
  return { entries: glossary.map(entry => ({ ...entry, name: entry.term === entry.translation })), glossary, gaps: [] };
}

// A phrase as a pattern. Where it starts or ends with a Latin letter or a digit it must not continue a word; other
// writing, such as kana or Hangul, has no spaces to hold it to, and particles follow a name directly.
const wordish = String.raw`[\p{Script=Latin}\p{N}]`;
function phrase(text: string, flags: string) {
  const escaped = text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`);
  const edge = (character: string) => new RegExp(wordish, 'u').test(character);
  const first = [...text.trim()][0]!, last = [...text.trim()].at(-1)!;
  return new RegExp(`${edge(first) ? `(?<!${wordish})` : ''}${escaped}${edge(last) ? `(?!${wordish})` : ''}`, flags);
}

// Entries the source text holds, and those among them whose counterpart the translation lacks, by kind. A name must be
// in the translation exactly as written; a term in any letter case. For terms the count is approximate, since an
// inflected form does not match; for names it is firm.
export function termMisses(entries: Entry[], pair: Pair, source: string, original: string, translation: string) {
  const counts = { names: 0, nameMisses: 0, terms: 0, termMisses: 0 };
  const forward = source === pair[0];
  if (!forward && source !== pair[1]) return counts;
  for (const entry of entries) {
    const [from, to] = forward ? [entry.term, entry.translation] : [entry.translation, entry.term];
    if (!phrase(from, 'iu').test(original)) continue;
    const kept = entry.name ? translation.includes(to) : translation.toLowerCase().includes(to.toLowerCase());
    if (entry.name) { counts.names++; if (!kept) counts.nameMisses++; }
    else { counts.terms++; if (!kept) counts.termMisses++; }
  }
  return counts;
}
