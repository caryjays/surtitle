// Pure decisions for rolling segmentation. LocalTranscriber owns audio, the worker and events.
// Design and measurements: docs/log/2026-10-26-rolling-recognition-design.md.
import { PROFILES } from '../protocol/languages.ts';

export type WorkerSegment = { endMs: number; text: string };

export const ROLLING = {
  intervalMs: 1000, // new audio between decodes; one decode in flight at most
  minWindowMs: 500,
  settleMs: 500, // a segment must end this long before the newest audio to lock
  forceMs: 25_000, // lock without agreement rather than approach Whisper's 30 s input
  maxWindowMs: 29_000,
  noiseMs: 3000, // no segments over this long a window means noise; keep only the last second
  keepMs: 1000,
  // After a noise trim, the next lock needs a decode this confident: a stretch held open by music or noise otherwise
  // locks the first time two hallucinated decodes happen to agree.
  noiseConfirmLogprob: -0.5,
  sentenceRowMs: 3000, // a row closes at sentence punctuation once it holds this much locked audio
  maxRowMs: 8000, // or at this much, which is what closes Japanese rows in continuous speech
  stockMs: 6000,
  // Consecutive decodes outside the pair, about a second each, before an empty row shows a marker for them.
  otherMarkDecodes: 3,
};

// Text two consecutive hypotheses agree on, never ending inside a Latin word or number.
export function stablePrefix(previous: string, current: string) {
  let n = 0;
  while (n < previous.length && n < current.length && previous[n] === current[n]) n++;
  const stable = current.slice(0, n);
  return /[A-Za-z0-9]$/.test(stable) && /[A-Za-z0-9]/.test(current[n] ?? '') ? stable.replace(/[A-Za-z0-9]+$/, '') : stable;
}

export function hypothesis(segments: WorkerSegment[]) {
  return segments.map(s => s.text).join('').trimStart();
}

// How many leading segments to lock: whole segments inside the stable text that ended at least settleMs
// before the newest audio. At the end of a stretch everything locks; past forceMs all but the last does.
export function lockCount(segments: WorkerSegment[], stable: string, windowMs: number, final: boolean, settleMs = ROLLING.settleMs) {
  if (final) return { count: segments.length, forced: false };
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    if (hypothesis(segments.slice(0, i + 1)).length > stable.length || segments[i]!.endMs > windowMs - settleMs) break;
    count = i + 1;
  }
  if (!count && windowMs >= ROLLING.forceMs && segments.length) return { count: Math.max(1, segments.length - 1), forced: true };
  return { count, forced: false };
}

// Append locked text to a row, keeping a space between Latin words that Whisper sometimes omits.
export function joinText(row: string, text: string) {
  if (!row) return text.trimStart();
  if (/\s$/.test(row) || /^\s/.test(text)) return row + text;
  return /[A-Za-z0-9.,!?;:'")]$/.test(row) && /^[A-Za-z0-9"'(]/.test(text) ? `${row} ${text}` : row + text;
}

// ends lists the sentence-final characters of the session's languages; closing quotes and brackets may follow.
export function endsSentence(text: string, ends: string) {
  const set = [...ends].map(c => c.replace(/[\\\]^-]/g, '\\$&')).join('');
  return new RegExp(`[${set}][\\s"'”’」』）)]*$`, 'u').test(text);
}

// Sign-offs Whisper emits in place of ordinary speech, from every language profile, since a hallucination
// need not be in the session's languages. scripts/local/quality.py reads the same profiles.
const STOCK_PHRASES = Object.values(PROFILES).flatMap(profile => profile.stockPhrases);
const compact = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export function isStockPhrase(text: string) {
  let rest = compact(text);
  if (!rest) return false;
  for (const phrase of STOCK_PHRASES) rest = rest.replaceAll(compact(phrase), '');
  return !rest;
}

// Text without case, spacing or punctuation: two decodes of the same speech often differ only in those.
export function loose(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
// The position in text just after its first `count` letters and digits.
function afterLoose(text: string, count: number) {
  let n = 0;
  for (let seen = 0; n < text.length && seen < count; n++) if (/[\p{L}\p{N}]/u.test(text[n]!)) seen++;
  return n;
}
// What is left of an agreed tail once `locked` text, heard at its start, has locked: nothing if they do not match.
export function agreedRest(agreed: string, locked: string) {
  const start = loose(locked);
  return loose(agreed).startsWith(start) ? agreed.slice(afterLoose(agreed, start.length)).replace(/^[^\p{L}\p{N}]+/u, '') : '';
}
// The agreed tail to show: the newest agreement, unless it covers less speech than the one shown, which then stays.
// Agreement shrinks when one decode wavers and after every lock, whose trimmed window is decoded afresh.
export function agreedTail(shown: string, candidate: string) {
  return loose(candidate).length < loose(shown).length ? shown : candidate;
}
// An unlocked tail for display: the agreed text as shown, then what the newest decode adds to it.
export function tailAfterAgreed(agreed: string, tail: string) {
  if (!agreed) return tail;
  const start = loose(agreed);
  return loose(tail).startsWith(start) ? agreed + tail.slice(afterLoose(tail, start.length)) : agreed;
}
