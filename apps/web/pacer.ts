import { PROFILES, type Pair, type Segment, type Snapshot } from '../../packages/protocol/index.ts';

// A row as displayed: original and translation hold the released text; the rests hold what is not released yet,
// including a partial row's unlocked tail, which only the operator sees.
export type ShownRow = Segment & { originalRest: string; translationRest: string };
export type PaceSettings = { enabled: boolean; drainMs: number; catchUpMs: number };
export const DEFAULT_PACE: PaceSettings = { enabled: true, drainMs: 4000, catchUpMs: 10_000 };
// A throttled or sleeping page releases at most a second's worth per step, then catches up.
const MAX_STEP_MS = 1000;
const MAX_BOOST = 3;
const BOOST_PER_SECOND = 0.5;
const SMOOTHING_MS = 500;

const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
// The language whose rates pace a text. A partial row has no language yet, so its script decides.
export function rateLanguage(text: string, known: string, pair: Pair) {
  if (PROFILES[known]) return known;
  const character = pair.find(language => PROFILES[language]?.scoring === 'character');
  return character && NON_LATIN.test(text) ? character : pair.find(language => PROFILES[language]?.scoring === 'word') ?? pair[0];
}
// How much of text a reader sees once count characters are released: whole words in languages written with spaces.
export function shownLength(text: string, count: number, language: string) {
  if (count >= text.length) return text.length;
  if (!PROFILES[language]?.spaced) return Math.max(0, Math.floor(count));
  return Math.max(0, text.lastIndexOf(' ', Math.floor(count)));
}
function commonPrefix(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

type Lane = { rate: number; boost: number; budget: number };
type Item = { key: string; text: string; language: string };

// Releases each client's text at a reading pace. Originals and translations are separate lanes, each released in row order.
// Text present when a session, display generation or connection starts is shown at once; only new text is paced.
export class Pacer {
  private released = new Map<string, { text: string; count: number }>();
  private lanes: Record<'original' | 'translation', Lane> = { original: this.lane(), translation: this.lane() };
  private key?: string;
  private last?: number;
  busy = false;
  constructor(public settings: PaceSettings = DEFAULT_PACE) {}
  configure(settings: PaceSettings) { this.settings = settings; }
  private lane(): Lane { return { rate: 0, boost: 1, budget: 0 }; }
  private reset() {
    this.released.clear(); this.lanes = { original: this.lane(), translation: this.lane() };
    this.last = undefined; this.busy = false;
  }
  update(state: Snapshot | undefined, now: number): ShownRow[] {
    if (!state) { this.key = undefined; this.reset(); return []; }
    const key = `${state.sessionId}:${state.generation}`;
    const fresh = key !== this.key;
    if (fresh) { this.key = key; this.reset(); }
    const step = this.last === undefined ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - this.last));
    this.last = now;
    const rows = state.segments;
    const items = (lane: 'original' | 'translation') => rows.map(row => {
      const text = lane === 'original' ? row.original.slice(0, row.stable ?? row.original.length) : row.translation ?? '';
      return { key: `${lane}:${row.id}`, text, language: rateLanguage(text, lane === 'original' ? row.source : row.target, state.pair) };
    });
    const original = items('original'); const translation = items('translation');
    const live = new Set([...original, ...translation].map(item => item.key));
    for (const key of this.released.keys()) if (!live.has(key)) this.released.delete(key);
    this.busy = false;
    for (const [name, list] of [['original', original], ['translation', translation]] as const) {
      for (const item of list) {
        const entry = this.released.get(item.key);
        if (fresh || !this.settings.enabled) this.released.set(item.key, { text: item.text, count: item.text.length });
        else if (!entry) this.released.set(item.key, { text: item.text, count: 0 });
        // Turns mode can rewrite a preview at its final; released text that no longer matches is re-released.
        else this.released.set(item.key, { text: item.text, count: Math.min(entry.count, commonPrefix(entry.text, item.text)) });
      }
      this.release(this.lanes[name], list, step);
    }
    const shown = (item: Item) => item.text.slice(0, shownLength(item.text, this.released.get(item.key)!.count, item.language));
    return rows.map((row, i) => {
      const o = shown(original[i]!); const t = shown(translation[i]!);
      return { ...row, original: o, originalRest: row.original.slice(o.length), translation: t || null,
        translationRest: (row.translation ?? '').slice(t.length) };
    });
  }
  private release(lane: Lane, items: Item[], stepMs: number) {
    const pending = items.filter(item => this.released.get(item.key)!.count < item.text.length);
    if (!pending.length) { lane.budget = 0; lane.rate = 0; return; }
    this.busy = true;
    // Rates are those of the row being released; other rows' backlog converts by the ratio of ceilings.
    const { floor, ceiling } = PROFILES[pending[0]!.language]!.reading;
    const scale = (item: Item) => ceiling / PROFILES[item.language]!.reading.ceiling;
    const backlog = pending.reduce((sum, item) => sum + (item.text.length - this.released.get(item.key)!.count) * scale(item), 0);
    const seconds = stepMs / 1000;
    // Far behind, the ceiling rises gradually instead of jumping, and falls back once caught up.
    lane.boost = backlog / ceiling > this.settings.catchUpMs / 1000
      ? Math.min(MAX_BOOST, lane.boost + BOOST_PER_SECOND * seconds) : Math.max(1, lane.boost - BOOST_PER_SECOND * seconds);
    const target = Math.min(ceiling * lane.boost, Math.max(floor, backlog / (this.settings.drainMs / 1000)));
    // New text raises the rate smoothly; a draining backlog holds it, so a row's end does not slow to the floor.
    if (!lane.rate) lane.rate = target;
    else if (target > lane.rate) lane.rate += (target - lane.rate) * Math.min(1, stepMs / SMOOTHING_MS);
    else lane.rate = Math.min(lane.rate, ceiling * lane.boost);
    lane.budget += lane.rate * seconds;
    for (const item of pending) {
      const entry = this.released.get(item.key)!;
      const take = Math.min(lane.budget, (item.text.length - entry.count) * scale(item));
      entry.count += take / scale(item); lane.budget -= take;
      if (entry.count > item.text.length - 1e-9) entry.count = item.text.length;
      if (lane.budget <= 1e-9) break;
    }
    if (pending.every(item => this.released.get(item.key)!.count >= item.text.length)) lane.budget = 0;
  }
}
