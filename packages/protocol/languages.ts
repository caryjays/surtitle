import { z } from 'zod';
import profiles from '../../profiles/languages.json' with { type: 'json' };

// ISO 639 codes as Whisper reports them. A script variant, such as Traditional Chinese, is a profile setting.
export const Language = z.string().regex(/^[a-z]{2,3}$/);
// Writing systems a profile can be shown in, as BCP 47 script subtags. A session shows its pair in one script.
export const Script = z.enum(['Hans', 'Hant']);
export type Script = z.infer<typeof Script>;
export type Language = z.infer<typeof Language>;
export const Source = z.union([Language, z.literal('unknown')]);
export type Source = z.infer<typeof Source>;
// auto, or a direction written source-target such as en-ja.
export const Mode = z.string().regex(/^(auto|[a-z]{2,3}-[a-z]{2,3})$/);
export type Mode = z.infer<typeof Mode>;
export const Pair = z.tuple([Language, Language]).refine(([a, b]) => a !== b);
export type Pair = z.infer<typeof Pair>;

// Language-specific rules, one profile per language; see profiles/languages.json.
export const LanguageProfile = z.object({
  name: z.string().min(1).max(40),
  scoring: z.enum(['word', 'character']),
  // Character scoring only: a run of Latin letters or digits counts as one unit, for speech that switches into English.
  latinWords: z.boolean().optional(),
  // Whether the language writes spaces between words. Not the same as scoring: Korean is spaced and scored by character.
  spaced: z.boolean(),
  sentenceEnd: z.string().min(1).max(20),
  // Clause punctuation; rolling segmentation can close a shorter row at one when given a clause length.
  clauseEnd: z.string().min(1).max(20),
  // Character scoring only: the language's letters as Unicode character-name prefixes, for the worker's check that a decode
  // forced into the language is written in it. Without it, kanji and kana; Korean sets HANGUL.
  letters: z.array(z.string().regex(/^[A-Z][A-Z ]{0,39}$/)).min(1).max(4).optional(),
  // Writing a translation into the language never holds, as Unicode character-name prefixes. The local translator cannot
  // generate a token that holds such a character; Korean rules out Chinese characters and kana.
  foreign: z.array(z.string().regex(/^[A-Z][A-Z ]{0,39}$/)).min(1).max(8).optional(),
  // Particles written onto the word before them. The local translator leaves a space between a number or Latin word and
  // its particle, "AI 는"; in a translation into the language that space is removed. A closed list of whole words, so
  // an ordinary word after a number keeps its space.
  particles: z.array(z.string().min(1).max(8)).min(1).max(40).optional(),
  // The language's writing, as Unicode script names, that stands directly beside a Latin word or number. The local
  // translator leaves a space there, "AI は" and "10 月"; in a translation into the language that space is removed.
  adjoining: z.array(z.enum(['Han', 'Hiragana', 'Katakana'])).min(1).optional(),
  stockPhrases: z.array(z.string().min(1).max(80)).max(32),
  // Sign-offs that vary, such as a subtitle credit followed by any name: each must match the whole compacted text, as
  // both a JavaScript (u flag) and a Python regular expression. Keeps names out of the profile.
  stockPatterns: z.array(z.string().min(1).max(120)).max(8).optional(),
  // Display release rate in characters per second: the floor keeps a sparse speaker moving, the ceiling caps bursts.
  reading: z.object({ floor: z.number().positive().max(100), ceiling: z.number().positive().max(100) }).strict()
    .refine(r => r.floor <= r.ceiling),
  // Label of a marker row: speech was heard and is not captioned. Shown in both pair languages, never naming the speech's.
  uncaptioned: z.string().min(1).max(40),
  // A language written in more than one script: what each shows, the first being the default. Text recognized in the
  // language, and translations into it, are converted to the session's script; convert names the OpenCC target.
  scripts: z.partialRecord(Script, z.object({
    name: z.string().min(1).max(40), uncaptioned: z.string().min(1).max(40), convert: z.enum(['cn', 'tw']),
  }).strict()).optional(),
}).strict();
export type LanguageProfile = z.infer<typeof LanguageProfile>;
export const PROFILES: Record<string, LanguageProfile> = z.record(Language, LanguageProfile).parse(profiles);
export const DEFAULT_PAIR: Pair = ['en', 'ja'];

export function parsePair(value: string): Pair {
  const pair = Pair.parse(value.split('-'));
  for (const language of pair) if (!PROFILES[language]) throw new Error(`No language profile for ${language}`);
  return pair;
}
// A session's pair and the script its text is shown in; script is null when neither language has more than one.
export type PairChoice = { pair: Pair; script: Script | null };
// Written like en-ja or en-zh-Hant: the pair, then the script subtag when a language of it has scripts. Without the
// subtag such a pair takes its language's first script.
export const PairTag = z.string().regex(/^[a-z]{2,3}-[a-z]{2,3}(-[A-Z][a-z]{3})?$/);
export function parsePairTag(value: string): PairChoice {
  const parts = value.split('-');
  if (parts.length > 3) throw new Error('Bad pair');
  const pair = parsePair(parts.slice(0, 2).join('-'));
  const subtag = parts.length === 3 ? Script.parse(parts[2]) : null;
  const scripted = pair.filter(language => scriptsOf(language).length);
  if (scripted.length > 1) throw new Error('Only one language of a pair may have scripts');
  const offered = scripted.length ? scriptsOf(scripted[0]!) : [];
  if (subtag && !offered.includes(subtag)) throw new Error(`No ${subtag} script for this pair`);
  return { pair, script: subtag ?? offered[0] ?? null };
}
export function pairTag({ pair, script }: PairChoice) {
  return [...pair, ...(script ? [script] : [])].join('-');
}
export function scriptsOf(language: Language): Script[] {
  return Object.keys(profile(language).scripts ?? {}) as Script[];
}
// The pairs a session can be switched to: English with each other profiled language, once per script it has.
export function offeredPairs(): PairChoice[] {
  return Object.keys(PROFILES).filter(language => language !== 'en').flatMap(language => {
    const scripts = scriptsOf(language);
    return (scripts.length ? scripts : [null]).map(script => ({ pair: ['en', language] as Pair, script }));
  });
}
// A language's profile as shown in a script: its name and marker label come from the script, when it has scripts.
// Without a script, or with one it does not have, the first applies.
export function profile(language: Language, script?: Script | null): LanguageProfile {
  const found = PROFILES[language];
  if (!found) throw new Error(`No language profile for ${language}`);
  if (!found.scripts) return found;
  const shown = (script && found.scripts[script]) || Object.values(found.scripts)[0]!;
  return { ...found, name: shown.name, uncaptioned: shown.uncaptioned };
}
export function modes(pair: Pair): Mode[] {
  return ['auto', `${pair[0]}-${pair[1]}`, `${pair[1]}-${pair[0]}`];
}
// Source and target of a direction mode, or null for auto.
export function direction(mode: Mode): { source: Language; target: Language } | null {
  if (mode === 'auto') return null;
  const [source, target] = mode.split('-') as [Language, Language];
  return { source, target };
}
export function inPair(pair: readonly Language[], language: string): language is Language {
  return pair.includes(language);
}
