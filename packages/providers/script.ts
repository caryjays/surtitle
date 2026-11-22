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
