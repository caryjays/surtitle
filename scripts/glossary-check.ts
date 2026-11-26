import { offeredPairs, pairTag } from '../packages/protocol/index.ts';
import { projectTerms } from '../packages/providers/terms.ts';
import { PRIVATE_GLOSSARIES, loadTermSets } from '../apps/service/glossary.ts';

// pnpm glossary:check: the term sets the service would offer, and what each sends in each pair. Counts only, so its
// output is safe to share; --gaps also lists the terms a pair leaves out.
const listGaps = process.argv.includes('--gaps');
try {
  const { sets, source, skipped } = await loadTermSets(process.env.GLOSSARY_PATH);
  console.log(`Starting set: ${source}. ${sets.length} sets offered.${skipped ? ` ${skipped} file(s) left out: invalid, or a name already in use; check ${PRIVATE_GLOSSARIES}.` : ''}`);
  for (const [index, set] of sets.entries()) {
    console.log(`\nSet ${index + 1}${listGaps ? ` · ${set.name}` : ''}: ${set.terms.length} entries, ${set.terms.filter(term => term.heard).length} with heard spellings`);
    for (const choice of offeredPairs()) {
      const { entries, gaps } = projectTerms(set, choice.pair, choice.script);
      console.log(`  ${pairTag(choice).padEnd(10)} ${entries.filter(entry => entry.name).length} names, ${entries.filter(entry => !entry.name).length} terms, ${gaps.length} left out${listGaps && gaps.length ? `: ${gaps.join(', ')}` : ''}`);
    }
  }
  if (skipped) process.exitCode = 1;
} catch { console.error('The starting glossary is missing or invalid.'); process.exitCode = 1; }
