import * as OpenCC from 'opencc-js';
import { PROFILES, type Script } from '../protocol/languages.ts';

// Text in a language with scripts, shown in the session's script. Whisper writes Chinese in either script, and can switch
// between decodes of the same audio; translators drift too. Every form folds to Simplified first, so Hong Kong and
// OpenCC forms reach the same Taiwan form, then converts to the target. Character forms only: regional vocabulary is
// left to the glossary and context. Only text known to be in the language is converted; Japanese kanji would be damaged.
const fold = OpenCC.Converter({ from: 't', to: 'cn' });
const targets: Record<'cn' | 'tw', (text: string) => string> = {
  cn: fold,
  tw: (() => { const tw = OpenCC.Converter({ from: 'cn', to: 'tw' }); return (text: string) => tw(fold(text)); })(),
};

export function inScript(language: string, script: Script | null | undefined, text: string) {
  const scripts = PROFILES[language]?.scripts;
  if (!scripts || !text) return text;
  const shown = (script && scripts[script]) || Object.values(scripts)[0]!;
  return targets[shown.convert](text);
}

// A translation with the spaces closed that its language does not write beside a Latin word or number. Where the
// profile lists particles, each is joined to the number or Latin word before it: "2020 에" becomes "2020에". open marks
// a reply still streaming, whose last word may yet grow, so it is left alone. Where the profile lists adjoining
// writing, a space between a Latin letter, digit or percent sign and a character of that writing is removed on either
// side: "AI は 10 月" becomes "AIは10月". A space between two Latin words or numbers stays.
const joins = new Map<string, RegExp>(), closes = new Map<string, RegExp>();
const latin = String.raw`[\p{Script=Latin}0-9%]`;
export function attached(language: string, text: string, open = false) {
  const { particles, adjoining } = PROFILES[language] ?? {};
  if (!text) return text;
  if (adjoining) {
    let close = closes.get(language);
    if (!close) {
      const own = `[${adjoining.map(script => String.raw`\p{scx=${script}}`).join('')}]`;
      closes.set(language, close = new RegExp(`(?<=${latin}) +(?=${own})|(?<=${own}) +(?=${latin})`, 'gu'));
    }
    text = text.replace(close, '');
  }
  if (!particles) return text;
  let join = joins.get(language);
  if (!join) joins.set(language, join = new RegExp(`([A-Za-z0-9%]) (${[...particles].sort((a, b) => b.length - a.length).join('|')})(?=([\\s.,!?;:)"'…]|$))`, 'gu'));
  return text.replace(join, (match, before: string, particle: string, after: string, at: number) =>
    open && after === '' && at + match.length === text.length ? match : before + particle);
}
