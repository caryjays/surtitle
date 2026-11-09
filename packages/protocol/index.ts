import { z } from 'zod';
import { TurnTrace } from './diagnostics.ts';
import { Mode, Pair, Source } from './languages.ts';
export { Boundary, RecognitionQuality, TurnMeasurement, TranslationDiagnostic, TurnTrace, endsInEllipsis } from './diagnostics.ts';
export * from './languages.ts';

export const Glossary = z.array(z.object({ term: z.string().min(1).max(80), translation: z.string().min(1).max(120) }).strict()).max(32);
export type Glossary = z.infer<typeof Glossary>;
// How speech becomes rows: pause-bounded turns, or rolling decodes that lock agreed text; see docs/wiki/recognition.md.
export const Segmentation = z.enum(['turns', 'rolling']);
export type Segmentation = z.infer<typeof Segmentation>;
export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), mode: Mode }).strict(),
  z.object({ type: z.literal('set-mode'), mode: Mode }).strict(),
  z.object({ type: z.literal('flush') }).strict(),
  z.object({ type: z.literal('calibrate') }).strict(),
  z.object({ type: z.literal('pause') }).strict(),
  z.object({ type: z.literal('clear') }).strict(),
  z.object({ type: z.literal('new-session') }).strict(),
  z.object({ type: z.literal('capture-failed') }).strict(),
  z.object({ type: z.literal('set-segmentation'), segmentation: Segmentation }).strict(),
  z.object({ type: z.literal('set-translation'), enabled: z.boolean() }).strict(),
]);
export const Failure = z.enum(['credentials', 'transcription', 'translation', 'translation-auth', 'translation-rate-limit', 'translation-network', 'capture', 'overload', 'protocol', 'session-limit']);
export type Failure = z.infer<typeof Failure>;
export const Translation = z.object({
  source: Source, target: Source, text: z.string().max(4000),
}).strict().refine(r => r.source === 'unknown' ? r.target === 'unknown' && r.text === '' : r.target !== 'unknown' && r.source !== r.target && r.text.trim().length > 0);
export type Translation = z.infer<typeof Translation>;
// Recent context is untrusted data, never a conversation with model privileges.
export const TranslationContext = z.array(z.object({
  original: z.string().max(800), translation: z.string().max(800).nullable(),
  source: Source,
}).strict()).max(4);
export type TranslationContext = z.infer<typeof TranslationContext>;
export const TranslationInput = z.object({
  text: z.string().min(1).max(4000), mode: Mode, glossary: Glossary,
  sourceLanguage: Source.optional(), context: TranslationContext.optional(),
  // Whether the turn was cut at the maximum duration: its first or last word may be partial.
  truncated: z.object({ start: z.boolean(), end: z.boolean() }).strict().optional(),
  // A locked piece of a row that is still open: the sentence may go on after text.
  continues: z.boolean().optional(),
}).strict();
export type TranslationInput = z.infer<typeof TranslationInput>;
export const MAX_SEGMENTS = 60;
export const Segment = z.object({
  id: z.string().max(100), sequence: z.number().int().nonnegative(), original: z.string().max(4000),
  final: z.boolean(), translation: z.string().max(4000).nullable(),
  source: Source, target: Source,
  state: z.enum(['partial', 'pending', 'ready', 'failed', 'unresolved', 'skipped', 'original']),
  finalizedAt: z.number().nullable(), translationMs: z.number().nonnegative().nullable(),
  // Leading characters of a partial original that are locked; displays reveal only these. Absent: all of it.
  stable: z.number().int().nonnegative().max(4000).optional(),
});
export type Segment = z.infer<typeof Segment>;
export const AudioGate = z.object({
  state: z.enum(['calibrating', 'quiet', 'speech']),
  level: z.number().min(0).max(1), threshold: z.number().min(0).max(1),
  remainingMs: z.number().int().min(0).max(2000),
}).strict();
export type AudioGate = z.infer<typeof AudioGate>;
export const Snapshot = z.object({
  type: z.literal('snapshot'), sessionId: z.string().uuid(), generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(), pair: Pair, mode: Mode,
  capture: z.enum(['paused', 'connecting', 'active', 'stopping', 'failed']),
  error: Failure.nullable(), backend: z.string().max(160),
  processing: z.enum(['local-only', 'local-audio-local-text', 'local-audio-cloud-text', 'cloud-audio-and-text', 'cloud-audio-only']),
  queue: z.number().int().nonnegative().max(8), running: z.number().int().nonnegative().max(2),
  gate: AudioGate.nullable().default(null), rejected: z.number().int().nonnegative().default(0),
  segments: z.array(Segment).max(MAX_SEGMENTS), sentAt: z.number(),
  // Content-free recent turn outcomes survive rejected rows, but reset with display generation.
  turns: z.array(TurnTrace).max(MAX_SEGMENTS).default([]),
  turnTelemetryVersion: z.literal(2).optional(),
  // null: the recognizer has one fixed segmentation. Translation is available only when the service was started with it.
  segmentation: Segmentation.nullable().default(null),
  translation: z.object({ available: z.boolean(), enabled: z.boolean() }).strict().default({ available: false, enabled: false }),
});
export type Snapshot = z.infer<typeof Snapshot>;
export const SAMPLE_RATE = 24000;
export const FRAME_SAMPLES = 1200; // 50 ms, mono PCM16 little endian
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const CAPTION_TTL_MS = 20_000;
export const HEARTBEAT_TIMEOUT_MS = 6_000;
