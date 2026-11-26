import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Glossary, TermSet } from '../../packages/protocol/index.ts';

// Personal terminology lives in the ignored private overlay; the tracked example is generic.
export const PRIVATE_GLOSSARY = 'private/glossary.json';
export const PRIVATE_GLOSSARIES = 'private/glossaries';
export const EXAMPLE_GLOSSARY = 'profiles/glossary.example.json';
// The tracked default before the private overlay existed. A .env still naming it falls through.
const RETIRED_DEFAULT = 'profiles/glossary.json';

export type GlossarySource = 'custom path' | 'private' | 'example';
async function exists(path: string) { try { await access(path); return true; } catch { return false; } }

export async function resolveGlossaryPath(configured?: string): Promise<{ path: string; source: GlossarySource; retiredDefault: boolean }> {
  const explicit = configured?.trim();
  const retiredDefault = explicit === RETIRED_DEFAULT && !(await exists(explicit));
  if (explicit && !retiredDefault) return { path: explicit, source: 'custom path', retiredDefault: false };
  if (await exists(PRIVATE_GLOSSARY)) return { path: PRIVATE_GLOSSARY, source: 'private', retiredDefault };
  return { path: EXAMPLE_GLOSSARY, source: 'example', retiredDefault };
}
// A term set file, or the list of { term, translation } that came before it. The list names no languages and was
// written for English and Japanese, so it is read as that: an entry mapped to itself is a name, any other an English
// term with its Japanese form. For en-ja it sends what it always sent; in other pairs only its names.
export async function loadGlossary(path: string, name = 'Glossary'): Promise<TermSet> {
  const data = z.union([TermSet, Glossary]).parse(JSON.parse(await readFile(path, 'utf8')));
  if (!Array.isArray(data)) return data;
  return TermSet.parse({ name, terms: data.map(({ term, translation }) => term === translation ? { name: term } : { en: term, ja: translation }) });
}
// The sets a session can use: the resolved one first, then each valid file of the private folder, the tracked example,
// and an empty set. A set whose name is already taken is left out, as is a file that does not parse; skipped counts
// those, never naming their contents.
export async function loadTermSets(configured?: string) {
  const resolved = await resolveGlossaryPath(configured);
  const sets = [await loadGlossary(resolved.path, resolved.source === 'example' ? 'Example' : resolved.source === 'private' ? 'Private' : 'Custom')];
  let skipped = 0;
  const add = (set: TermSet) => { if (sets.some(other => other.name === set.name)) skipped++; else sets.push(set); };
  let files: string[] = [];
  try { files = (await readdir(PRIVATE_GLOSSARIES)).filter(file => file.endsWith('.json')).sort(); } catch { /* no private sets */ }
  for (const file of files) {
    try { add(await loadGlossary(join(PRIVATE_GLOSSARIES, file), file.replace(/\.json$/, '').slice(0, 40))); } catch { skipped++; }
  }
  if (resolved.source !== 'example') try { add(await loadGlossary(EXAMPLE_GLOSSARY, 'Example')); } catch { skipped++; }
  if (!sets.some(set => set.name === 'None')) sets.push({ name: 'None', terms: [] });
  return { ...resolved, sets, skipped };
}
