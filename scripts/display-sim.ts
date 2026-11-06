// Simulated sessions through the display pacer in virtual time: authored fictional speech, modeled rolling locks and
// translation latency, no audio, model or network. Reports how far behind speech each lane is released and how bursty it is.
import { DEFAULT_PACE, Pacer, type PaceSettings } from '../apps/web/pacer.ts';
import type { Segment, Snapshot } from '../packages/protocol/index.ts';

type Utterance = { language: 'en' | 'ja'; text: string; translation: string; pauseMs: number };
const EN = [
  ['Thanks for coming. Today I want to talk about how small teams keep a shared record of their decisions.', 'お越しいただきありがとうございます。今日は、小さなチームが決定事項の共有記録をどう残すかについて話します。'],
  ['Most teams start with good intentions, a document or a wiki page, and within a few months nobody trusts it anymore.', 'ほとんどのチームは文書やウィキのページから善意で始めますが、数か月もすると誰も信用しなくなります。'],
  ['The problem is not the tool. The problem is that writing things down happens after the decision, when everyone has moved on.', '問題は道具ではありません。問題は、記録が決定の後、皆が次に進んだ後に行われることです。'],
  ['So the first habit is simple: write the decision down in the meeting, in one sentence, before anyone leaves the room.', 'そこで最初の習慣は簡単です。誰かが部屋を出る前に、会議の中で決定を一文で書き留めることです。'],
  ['The second habit is to record what you rejected, because the rejected options are what people argue about again later.', '二つ目の習慣は、却下したものを記録することです。後で再び議論になるのは却下された選択肢だからです。'],
] as const;
const JA = [
  ['ありがとうございます。少し質問させてください。', 'Thank you. Let me ask a short question.'],
  ['却下した選択肢を記録するとき、理由まで書くべきでしょうか、それとも選択肢の名前だけで十分でしょうか。', 'When recording rejected options, should we write down the reasons too, or is the name of the option enough?'],
  ['私たちのチームでは、理由を書くと長くなりすぎて、結局誰も読まなくなってしまいました。', 'In our team, writing the reasons made the records too long, and in the end nobody read them.'],
] as const;
const utter = (rows: readonly (readonly [string, string])[], language: 'en' | 'ja', pauseMs: number) =>
  rows.map(([text, translation]) => ({ language, text, translation, pauseMs }));

// Speaking rates in characters per second: about 150 English words a minute, and a brisk Japanese lecture.
const RATE = { en: 14, ja: 7 };
type Scenario = { name: string; speech: Utterance[]; rate?: number; translationMs: [number, number]; settings?: Partial<PaceSettings> };
const SCENARIOS: Scenario[] = [
  { name: 'English lecture', speech: utter(EN, 'en', 400), translationMs: [1200, 2500] },
  { name: 'English lecture, fast speaker', speech: utter(EN, 'en', 200), rate: 1.4, translationMs: [1200, 2500] },
  { name: 'Japanese lecture', speech: utter(JA, 'ja', 500), translationMs: [1200, 2500] },
  { name: 'Q&A, alternating', speech: [utter(EN, 'en', 900).slice(0, 2), utter(JA, 'ja', 900), utter(EN, 'en', 900).slice(2)].flat(), translationMs: [1200, 2500] },
  { name: 'English lecture, slow translation', speech: utter(EN, 'en', 400), translationMs: [3000, 6000] },
  { name: 'English lecture, pacing off', speech: utter(EN, 'en', 400), translationMs: [1200, 2500], settings: { enabled: false } },
];

// Whisper-like segments: clause pieces split at punctuation, then at a length limit.
function segments(text: string, language: 'en' | 'ja') {
  const pieces = text.match(language === 'en' ? /[^.,!?]+[.,!?]?\s*/g : /[^、。！？]+[、。！？]?/g) ?? [text];
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (last && last.length < (language === 'en' ? 25 : 10)) out[out.length - 1] = last + piece; else out.push(piece);
  }
  return out;
}
let seed = 7;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

type Event = { at: number; apply: (rows: Map<string, Segment>) => void };
function timeline(scenario: Scenario) {
  const events: Event[] = []; const spoken: { row: string; lane: 'original' | 'translation'; at: number[] }[] = [];
  let t = 1000;
  scenario.speech.forEach((u, i) => {
    const id = `r${i}`; const rate = RATE[u.language] * (scenario.rate ?? 1);
    const start = t; const end = start + (u.text.length / rate) * 1000;
    const charAt = Array.from(u.text, (_, k) => start + ((k + 1) / rate) * 1000);
    spoken.push({ row: id, lane: 'original', at: charAt });
    // A segment locks once two decodes agree after its end is at least 1 s old: the next decode on the 1 s grid, plus one more.
    let locked = 0; let lockAt = start;
    for (const piece of segments(u.text, u.language)) {
      locked += piece.length;
      const segmentEnd = start + (locked / rate) * 1000;
      lockAt = Math.max(lockAt, Math.ceil((segmentEnd + 1000) / 1000) * 1000 + 1000 + random() * 400);
      const stable = u.text.slice(0, locked).trimEnd().length;
      events.push({ at: lockAt, apply: rows => {
        const row = rows.get(id) ?? { id, sequence: i, original: '', final: false, translation: null, source: 'unknown', target: 'unknown',
          state: 'partial', finalizedAt: null, translationMs: null } satisfies Segment;
        rows.set(id, { ...row, original: u.text.slice(0, stable), stable });
      } });
    }
    const target = u.language === 'en' ? 'ja' : 'en';
    events.push({ at: lockAt + 1, apply: rows => {
      const { stable: _, ...row } = rows.get(id)!;
      rows.set(id, { ...row, original: u.text, final: true, state: 'pending', source: u.language, target, finalizedAt: lockAt });
    } });
    const [low, high] = scenario.translationMs;
    const translated = lockAt + low + random() * (high - low);
    events.push({ at: translated, apply: rows => { rows.set(id, { ...rows.get(id)!, translation: u.translation, state: 'ready' }); } });
    // A translation character counts as spoken when the original sentence ended.
    spoken.push({ row: id, lane: 'translation', at: Array.from(u.translation, () => end) });
    t = end + u.pauseMs;
  });
  return { events: events.sort((a, b) => a.at - b.at), spoken, end: Math.max(...events.map(e => e.at)) };
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}
function simulate(scenario: Scenario) {
  const { events, spoken, end } = timeline(scenario);
  const pacer = new Pacer({ ...DEFAULT_PACE, ...scenario.settings });
  const rows = new Map<string, Segment>(); const released = new Map<string, number[]>(); const shown = new Map<string, number>();
  let next = 0;
  pacer.update({ sessionId: '00000000-0000-4000-8000-000000000000', generation: 0, pair: ['en', 'ja'], segments: [] } as unknown as Snapshot, 0);
  for (let now = 100; now < end + 60_000; now += 100) {
    while (next < events.length && events[next]!.at <= now) events[next++]!.apply(rows);
    const state = { sessionId: '00000000-0000-4000-8000-000000000000', generation: 0, pair: ['en', 'ja'], segments: [...rows.values()] } as unknown as Snapshot;
    for (const row of pacer.update(state, now)) {
      for (const [lane, text] of [['original', row.original], ['translation', row.translation ?? '']] as const) {
        const key = `${lane}:${row.id}`; const before = shown.get(key) ?? 0;
        for (let k = before; k < text.length; k++) (released.get(key) ?? released.set(key, []).get(key)!).push(now);
        shown.set(key, Math.max(before, text.length));
      }
    }
    if (next >= events.length && !pacer.busy) break;
  }
  const report: Record<string, string> = { scenario: scenario.name };
  for (const lane of ['original', 'translation'] as const) {
    const lags: number[] = []; const times: number[] = [];
    for (const s of spoken.filter(s => s.lane === lane)) {
      const at = released.get(`${lane}:${s.row}`) ?? [];
      s.at.forEach((spokenAt, k) => { if (at[k] !== undefined) { lags.push(at[k]! - spokenAt); times.push(at[k]!); } });
    }
    // The most characters released in any one second, a measure of bursts.
    let burst = 0;
    for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! >= 1000) j++; burst = Math.max(burst, i - j + 1); }
    report[lane] = `lag p50 ${(percentile(lags, 0.5) / 1000).toFixed(1)} s, p90 ${(percentile(lags, 0.9) / 1000).toFixed(1)} s, max ${(Math.max(...lags) / 1000).toFixed(1)} s; burst ${burst}/s`;
  }
  return report;
}

// --drain=MS overrides the drain time for every paced scenario, to compare settings.
const drain = Number(process.argv.find(a => a.startsWith('--drain='))?.split('=')[1]);
for (const scenario of SCENARIOS) {
  const r = simulate(drain ? { ...scenario, settings: { drainMs: drain, ...scenario.settings } } : scenario);
  console.log(`${r.scenario}\n  original:    ${r.original}\n  translation: ${r.translation}`);
}
