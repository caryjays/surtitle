import { z } from 'zod';
import profiles from '../../profiles/languages.json' with { type: 'json' };

// ISO 639 codes as Whisper reports them. A script variant, such as Traditional Chinese, is a profile setting.
export const Language = z.string().regex(/^[a-z]{2,3}$/);
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
  // Whether the language writes spaces between words. Not the same as scoring: Korean is spaced and scored by character.
  spaced: z.boolean(),
  sentenceEnd: z.string().min(1).max(20),
  // Clause punctuation; rolling segmentation can close a shorter row at one when given a clause length.
  clauseEnd: z.string().min(1).max(20),
  stockPhrases: z.array(z.string().min(1).max(80)).max(32),
  // Display release rate in characters per second: the floor keeps a sparse speaker moving, the ceiling caps bursts.
  reading: z.object({ floor: z.number().positive().max(100), ceiling: z.number().positive().max(100) }).strict()
    .refine(r => r.floor <= r.ceiling),
}).strict();
export type LanguageProfile = z.infer<typeof LanguageProfile>;
export const PROFILES: Record<string, LanguageProfile> = z.record(Language, LanguageProfile).parse(profiles);
export const DEFAULT_PAIR: Pair = ['en', 'ja'];

export function parsePair(value: string): Pair {
  const pair = Pair.parse(value.split('-'));
  for (const language of pair) if (!PROFILES[language]) throw new Error(`No language profile for ${language}`);
  return pair;
}
export function profile(language: Language) {
  const found = PROFILES[language];
  if (!found) throw new Error(`No language profile for ${language}`);
  return found;
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
