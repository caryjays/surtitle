// Gate part 6, translation delay: replays held-out talks in real time with the local translator, one pair at a time,
// through scripts/contention-replay.ts, then scores each talk's last word of a row to its first translated text against
// the part's targets. Run it on an otherwise idle Mac on mains power; it keeps the Mac awake while it runs. Offline: no
// .env, no network. Output, timings and counts only, goes to ignored benchmarks/results/delay-<stamp>/.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const GATES = ['ja', 'es', 'fr', 'it', 'pt'] as const;
type Gate = typeof GATES[number];
const TARGET = { p50Ms: 3000, p90Ms: 4500 };
const AUDIO = '.local/fixtures/held-out';

const { values } = parseArgs({ options: {
  gates: { type: 'string', default: GATES.join(',') },
  // A smoke run: at most this many talks per language. It checks the pipeline and is never a gate result.
  talks: { type: 'string' },
  // Score an existing run folder without replaying.
  score: { type: 'string' },
  // An experiment, never a gate result unless the hold goes live: replay:contention --hold <ms>.
  hold: { type: 'string' },
  // An experiment, never a gate result unless it goes live: replay:contention --fresh-length.
  'fresh-length': { type: 'boolean', default: false },
} });

const ids = (file: string, language: string) =>
  (JSON.parse(readFileSync(file, 'utf8')) as { fixtures: { id: string; language: string }[] }).fixtures
    .filter(f => f.language === language).map(f => f.id);

// Chosen before any part 6 run outside Japanese, and the same for every pair: the first two English excerpts, and every
// excerpt of the pair language. Japanese keeps the two talks of its earlier rounds, so its repeat compares with them.
function talks(gate: Gate, limit: number | null): string[] {
  const english = ids('benchmarks/gate-held-out.json', 'en').slice(0, 2);
  const own = gate === 'ja' ? ['held-ja--6K2nN9aWsg', 'held-ja-0jJLyvNn_to'] : ids(`benchmarks/gate-held-out-${gate}.json`, gate);
  return limit === null ? [...english, ...own] : [...english.slice(0, limit), ...own.slice(0, limit)];
}

const load = () => loadavg().map(v => Number(v.toFixed(2)));
const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

// diag:latency reports each Start in order; part 6 reads its first-translated-text section, rows translated whole.
function score(file: string, expected: string[]) {
  const report = spawnSync('npx', ['tsx', 'scripts/diagnostics-latency.ts', file], { encoding: 'utf8' });
  if (report.status !== 0) throw new Error(`diag:latency failed on ${file}`);
  const blocks = report.stdout.split(/^Start \d+:/m).slice(1);
  if (blocks.length !== expected.length) throw new Error(`${file}: ${blocks.length} starts for ${expected.length} talks`);
  return blocks.map((block, i) => {
    const section = block.slice(block.indexOf('Speech to first translated text'));
    const m = section.match(/last word of the row\s+n\s+(\d+)\s+p50\s+(\S+)\s+p90\s+(\S+)/);
    const ms = (v: string | undefined) => v === undefined || v === '–' ? null : Math.round(Number(v) * 1000);
    const [rows, p50Ms, p90Ms] = [m ? Number(m[1]) : 0, ms(m?.[2]), ms(m?.[3])];
    const status = p50Ms === null || p90Ms === null ? 'NOT MEASURED' : p50Ms <= TARGET.p50Ms && p90Ms <= TARGET.p90Ms ? 'PASS' : 'FAIL';
    return { talk: expected[i]!, rows, p50Ms, p90Ms, status };
  });
}

function print(results: { gate: string; talk: string; rows: number; p50Ms: number | null; p90Ms: number | null; status: string }[]) {
  const s = (ms: number | null) => ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`;
  console.log(`Last word of a row to its first translated text, each talk: median ≤ ${TARGET.p50Ms / 1000} s, p90 ≤ ${TARGET.p90Ms / 1000} s`);
  for (const r of results) console.log(`${r.status.padEnd(13)} ${r.gate}  ${r.talk.padEnd(22)} rows ${String(r.rows).padStart(3)}  median ${s(r.p50Ms).padStart(6)}  p90 ${s(r.p90Ms).padStart(6)}`);
}

if (values.score) {
  const run = JSON.parse(readFileSync(join(values.score, 'run.json'), 'utf8')) as { pairs: { gate: Gate; talks: string[] }[] };
  print(run.pairs.flatMap(p => score(join(values.score!, `${p.gate}.json`), p.talks).map(r => ({ gate: p.gate, ...r }))));
  process.exit(0);
}

const gates = values.gates!.split(',') as Gate[];
const limit = values.talks === undefined ? null : Number(values.talks);
if (!gates.length || gates.some(g => !GATES.includes(g)) || (limit !== null && !(Number.isInteger(limit) && limit >= 1))) {
  console.error('Usage: pnpm gate:delay [--gates ja,es,fr,it,pt] [--talks <n per language, smoke only>] [--hold <ms>, experiment] [--fresh-length, experiment] | --score <run folder>'); process.exit(2);
}
const plan = gates.map(gate => ({ gate, talks: talks(gate, limit) }));
const missing = plan.flatMap(p => p.talks).filter(id => !existsSync(join(AUDIO, `${id}.wav`)));
if (missing.length) {
  console.error(`${missing.length} held-out recordings are missing; run pnpm gate:held-out-fixtures, with --language for each pair.`); process.exit(1);
}

// Local time, as gate:run names its folders.
const now = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const out = join('benchmarks/results', `delay-${limit === null ? '' : 'smoke-'}${values.hold ? `hold${values.hold}-` : ''}${values['fresh-length'] ? 'fresh-' : ''}${stamp}`);
mkdirSync(out, { recursive: true });
// Keeps the Mac from idle sleep while this process lives: a sleeping Mac ends a replay with an inference backlog.
spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
const power = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout.includes("'AC Power'") ? 'mains' : 'battery or unknown';
if (power !== 'mains') console.error('Warning: not on mains power. A gate run needs it.');
const run = { smoke: limit !== null, ...(values.hold ? { hold: values.hold } : {}), ...(values['fresh-length'] ? { freshLength: true } : {}), commit: git('rev-parse', '--short', 'HEAD'), uncommittedChanges: git('status', '--porcelain') !== '',
  started: new Date().toISOString(), power, pairs: [] as { gate: Gate; pair: string; talks: string[]; loadBefore: number[]; loadAfter?: number[]; exit?: number | null }[] };
const save = () => writeFileSync(join(out, 'run.json'), JSON.stringify(run, null, 2) + '\n');

for (const { gate, talks: list } of plan) {
  const entry = { gate, pair: `en-${gate}`, talks: list, loadBefore: load() } as typeof run.pairs[number];
  run.pairs.push(entry); save();
  console.log(`Replaying en-${gate}: ${list.length} talks, about ${list.length * 6} min in real time; load ${entry.loadBefore.join(' ')}`);
  const replay = spawnSync('npx', ['tsx', 'scripts/contention-replay.ts', '--pair', `en-${gate}`, '--translate', 'local',
    '--out', join(out, `${gate}.json`), ...(values.hold ? ['--hold', values.hold] : []), ...(values['fresh-length'] ? ['--fresh-length'] : []), ...list.map(id => join(AUDIO, `${id}.wav`))], { stdio: 'inherit' });
  entry.loadAfter = load(); entry.exit = replay.status; save();
  if (replay.status !== 0) console.error(`en-${gate} replay failed; going on with the next pair.`);
}

const results = run.pairs.filter(p => p.exit === 0).flatMap(p => score(join(out, `${p.gate}.json`), p.talks).map(r => ({ gate: p.gate, ...r })));
writeFileSync(join(out, 'score.json'), JSON.stringify({ target: TARGET, results }, null, 2) + '\n');
print(results);
if (run.smoke) console.log('Smoke run: it checks the pipeline and is never a gate result.');
console.log(`Run: ${out}; load before and after each pair is in run.json.`);
