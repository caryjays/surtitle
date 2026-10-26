// Repository hygiene gate, run inside `pnpm check`:
// 1. wiki pages must be verified after their declared sources last changed;
// 2. relative Markdown links must resolve, and public docs must not link into private/;
// 3. every commit-eligible file is scanned for leak patterns and the private denylist;
// 4. private/ must stay ignored and untracked.
import { readdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const WIKI = 'docs/wiki';
const PRIVATE = 'private';
const DENYLIST = `${PRIVATE}/denylist.txt`;
const LINK_ROOTS = ['docs', 'README.md', 'AGENTS.md', 'benchmarks/README.md', 'profiles/README.md'];
const STATUS_MAX_AGE_DAYS = 14;
const HEADER = /^Verified: (\d{4}-\d{2}-\d{2}) · Sources: (.+)$/m;
const LEAK_PATTERNS: [string, RegExp][] = [
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['home directory path', /(?:\/Users|\/home)\/[A-Za-z0-9._-]+/],
  ['API key shape', /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|tskey-[A-Za-z0-9-]{10,})/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bearer token', /Bearer [A-Za-z0-9._-]{20,}/],
  ['non-loopback IPv4 address', /\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b/],
  ['link into private/', /\]\((?:\.\.\/)*private\//],
];
const today = new Date().toISOString().slice(0, 10);
const errors: string[] = [];
const warnings: string[] = [];

async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
async function files(path: string): Promise<string[]> {
  if ((await stat(path)).isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => files(join(path, entry.name))))).flat();
}
function git(args: string[]) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
async function lastChanged(source: string): Promise<string> {
  // Uncommitted edits have no commit date, so fall back to modification time.
  if (git(['status', '--porcelain', '--', source])) {
    let latest = '';
    for (const file of await files(source)) {
      const day = (await stat(file)).mtime.toISOString().slice(0, 10);
      if (day > latest) latest = day;
    }
    return latest;
  }
  return git(['log', '-1', '--format=%cs', '--', source]) || today;
}

async function checkWiki() {
  const pages = (await readdir(WIKI)).filter(name => name.endsWith('.md') && name !== 'README.md').sort();
  const index = await readFile(join(WIKI, 'README.md'), 'utf8');
  for (const name of pages) {
    const path = join(WIKI, name);
    if (!index.includes(`](${name})`)) errors.push(`${path}: not listed in ${WIKI}/README.md`);
    const match = HEADER.exec(await readFile(path, 'utf8'));
    if (!match || !match[1] || !match[2]) { errors.push(`${path}: missing "Verified: YYYY-MM-DD · Sources: …" line`); continue; }
    const verified = match[1];
    if (verified > today) errors.push(`${path}: verified date ${verified} is in the future`);
    if (name === 'status.md') {
      const age = Math.floor((Date.parse(today) - Date.parse(verified)) / 86_400_000);
      if (age > STATUS_MAX_AGE_DAYS) warnings.push(`${path}: status is ${age} days old; rewrite it at the next handoff`);
    }
    if (match[2].trim() === 'none') continue;
    for (const source of match[2].split(',').map(s => s.trim()).filter(Boolean)) {
      if (!(await exists(source))) { errors.push(`${path}: source ${source} does not exist`); continue; }
      const changed = await lastChanged(source);
      if (changed > verified) errors.push(`${path}: ${source} changed ${changed}, page verified ${verified}`);
    }
  }
}

async function checkLinks() {
  const markdown = (await Promise.all(LINK_ROOTS.map(files))).flat().filter(path => path.endsWith('.md'));
  const pattern = /\]\(([^)\s]+)\)/g;
  for (const path of markdown) {
    const text = await readFile(path, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const target = (match[1] ?? '').split('#')[0] ?? '';
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (!(await exists(resolve(dirname(path), decodeURIComponent(target))))) errors.push(`${path}: dead link ${target}`);
    }
  }
}

async function denylist(): Promise<RegExp[]> {
  if (!(await exists(DENYLIST))) { warnings.push(`${DENYLIST} not found; denylist scan skipped`); return []; }
  return (await readFile(DENYLIST, 'utf8')).split('\n').map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}

async function checkLeaks() {
  const ignored = (() => { try { execFileSync('git', ['check-ignore', '-q', `${PRIVATE}/x`]); return true; } catch { return false; } })();
  if (!ignored) errors.push(`${PRIVATE}/ is not ignored by Git`);
  const tracked = git(['ls-files', '--', PRIVATE]);
  if (tracked) errors.push(`${PRIVATE}/ has tracked files: ${tracked.split('\n').join(', ')}`);
  const terms = await denylist();
  const candidates = git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(Boolean);
  for (const path of candidates) {
    let buffer: Buffer;
    try { buffer = await readFile(path); } catch { continue; }
    if (buffer.subarray(0, 8192).includes(0)) continue; // binary
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [label, pattern] of LEAK_PATTERNS) if (pattern.test(line)) errors.push(`${path}:${index + 1}: ${label}`);
      for (const term of terms) if (term.test(line)) errors.push(`${path}:${index + 1}: denylisted term ${term.source.replace(/\\/g, '')}`);
    });
  }
  return candidates.length;
}

await checkWiki();
await checkLinks();
const scanned = await checkLeaks();
for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const error of errors) console.error(`error: ${error}`);
const pages = (await readdir(WIKI)).filter(name => name.endsWith('.md')).length;
console.log(`docs-check: ${pages} wiki pages, ${scanned} files scanned for leaks, ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exitCode = 1;
