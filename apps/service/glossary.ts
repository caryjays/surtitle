import { access, readFile } from 'node:fs/promises';
import { Glossary } from '../../packages/protocol/index.ts';

// Personal terminology lives in the ignored private overlay; the tracked example is generic.
export const PRIVATE_GLOSSARY = 'private/glossary.json';
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
export async function loadGlossary(path: string): Promise<Glossary> {
  return Glossary.parse(JSON.parse(await readFile(path, 'utf8')));
}
