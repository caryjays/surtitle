import { z } from 'zod';
import { PROFILES, Script } from './languages.ts';

// A term set: the names and terms of one product, stack or subject, kept in one file. An entry is one of two kinds.
// A name, { "name": "Claude Code" }, is a proper noun written as given in every pair and both directions; it may carry
// heard, other spellings the recognizer or the translator writes for it, each replaced by the name in recognized text
// and in translations, and a form for a language where the name is written otherwise.
// A term, { "en": "inference", "ja": "推論" }, is a preferred translation: one form per language, used when the session's
// pair has both. A form's key is a language code, or one with a script subtag such as zh-Hant for a form of that script.
const form = z.string().min(1).max(120);
function languageKey(key: string) {
  const [language, script, ...rest] = key.split('-');
  if (rest.length || !language || !PROFILES[language]) return false;
  return script === undefined || Boolean(Script.safeParse(script).success && PROFILES[language].scripts?.[script as Script]);
}
export const Term = z.object({
  name: z.string().min(1).max(80).optional(),
  // At least two characters, so one letter is never rewritten.
  heard: z.array(z.string().min(2).max(80)).min(1).max(8).optional(),
}).catchall(form).superRefine((term, ctx) => {
  const forms = Object.keys(term).filter(key => key !== 'name' && key !== 'heard');
  for (const key of forms) if (!languageKey(key)) ctx.addIssue({ code: 'custom', message: `${key} is not a profiled language` });
  // The English form is the term a request carries, which the request schema holds to 80 characters.
  if (typeof term.en === 'string' && term.en.length > 80) ctx.addIssue({ code: 'custom', message: 'the English form is at most 80 characters' });
  if (term.name === undefined) {
    if (term.heard) ctx.addIssue({ code: 'custom', message: 'heard belongs to a name' });
    if (new Set(forms.map(key => key.split('-')[0])).size < 2) ctx.addIssue({ code: 'custom', message: 'a term needs a name, or forms in two languages' });
  }
});
export type Term = z.infer<typeof Term>;
// At most 32 entries, the most one translation request carries.
export const TermSet = z.object({ name: z.string().min(1).max(40), terms: z.array(Term).max(32) }).strict();
export type TermSet = z.infer<typeof TermSet>;
