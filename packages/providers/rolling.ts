// Pure decisions for rolling segmentation. LocalTranscriber owns audio, the worker and events.
// Design and measurements: docs/log/2026-10-26-rolling-recognition-design.md.
export type WorkerSegment = { endMs: number; text: string };

export const ROLLING = {
  intervalMs: 1000, // new audio between decodes; one decode in flight at most
  minWindowMs: 500,
  settleMs: 1000, // a segment must end this long before the newest audio to lock
  forceMs: 25_000, // lock without agreement rather than approach Whisper's 30 s input
  maxWindowMs: 29_000,
  noiseMs: 3000, // no segments over this long a window means noise; keep only the last second
  keepMs: 1000,
  sentenceRowMs: 3000, // a row closes at sentence punctuation once it holds this much locked audio
  maxRowMs: 8000, // or at this much, which is what closes Japanese rows in continuous speech
  stockMs: 6000,
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
export function lockCount(segments: WorkerSegment[], stable: string, windowMs: number, final: boolean) {
  if (final) return { count: segments.length, forced: false };
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    if (hypothesis(segments.slice(0, i + 1)).length > stable.length || segments[i]!.endMs > windowMs - ROLLING.settleMs) break;
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

export function endsSentence(text: string) {
  return /[.!?。！？][\s"'”’」』）)]*$/u.test(text);
}

// Sign-offs Whisper emits in place of ordinary speech; mirrors STOCK_PHRASES in scripts/local/quality.py.
const STOCK_PHRASES = ['ご視聴ありがとうございました', 'ご清聴ありがとうございました', 'お疲れ様でした',
  'チャンネル登録よろしくお願いします', 'thankyouforwatching', 'thanksforwatching', 'thankyou'];
const compact = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{S}\s]/gu, '');
export function isStockPhrase(text: string) {
  let rest = compact(text);
  if (!rest) return false;
  for (const phrase of STOCK_PHRASES) rest = rest.replaceAll(compact(phrase), '');
  return !rest;
}
