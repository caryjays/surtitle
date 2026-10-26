import { z } from 'zod';
import { TurnTrace } from './diagnostics.ts';
export { Boundary, RecognitionQuality, TurnMeasurement, TranslationDiagnostic, TurnTrace, endsInEllipsis } from './diagnostics.ts';

export const Mode = z.enum(['auto', 'en-ja', 'ja-en']);
export type Mode = z.infer<typeof Mode>;
export const Glossary = z.array(z.object({ term: z.string().min(1).max(80), translation: z.string().min(1).max(120) }).strict()).max(32);
export type Glossary = z.infer<typeof Glossary>;
export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), mode: Mode }).strict(),
  z.object({ type: z.literal('set-mode'), mode: Mode }).strict(),
  z.object({ type: z.literal('flush') }).strict(),
  z.object({ type: z.literal('calibrate') }).strict(),
  z.object({ type: z.literal('pause') }).strict(),
  z.object({ type: z.literal('clear') }).strict(),
  z.object({ type: z.literal('new-session') }).strict(),
  z.object({ type: z.literal('capture-failed') }).strict(),
]);
export const Failure = z.enum(['credentials', 'transcription', 'translation', 'translation-auth', 'translation-rate-limit', 'translation-network', 'capture', 'overload', 'protocol', 'session-limit']);
export type Failure = z.infer<typeof Failure>;
export const Translation = z.object({
  source: z.enum(['en', 'ja', 'unknown']), target: z.enum(['en', 'ja', 'unknown']), text: z.string().max(4000),
}).strict().refine(r => r.source === 'unknown' ? r.target === 'unknown' && r.text === '' : r.target !== 'unknown' && r.source !== r.target && r.text.trim().length > 0);
export type Translation = z.infer<typeof Translation>;
// Recent context is untrusted data, never a conversation with model privileges.
export const TranslationContext = z.array(z.object({
  original: z.string().max(800), translation: z.string().max(800).nullable(),
  source: z.enum(['en', 'ja', 'unknown']),
}).strict()).max(4);
export type TranslationContext = z.infer<typeof TranslationContext>;
export const TranslationInput = z.object({
  text: z.string().min(1).max(4000), mode: Mode, glossary: Glossary,
  sourceLanguage: z.enum(['en', 'ja', 'unknown']).optional(), context: TranslationContext.optional(),
}).strict();
export type TranslationInput = z.infer<typeof TranslationInput>;
export const MAX_SEGMENTS = 60;
export const Segment = z.object({
  id: z.string().max(100), sequence: z.number().int().nonnegative(), original: z.string().max(4000),
  final: z.boolean(), translation: z.string().max(4000).nullable(),
  source: z.enum(['en', 'ja', 'unknown']), target: z.enum(['en', 'ja', 'unknown']),
  state: z.enum(['partial', 'pending', 'ready', 'failed', 'unresolved', 'skipped', 'original']),
  finalizedAt: z.number().nullable(), translationMs: z.number().nonnegative().nullable(),
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
  revision: z.number().int().nonnegative(), mode: Mode,
  capture: z.enum(['paused', 'connecting', 'active', 'stopping', 'failed']),
  error: Failure.nullable(), backend: z.string().max(160),
  processing: z.enum(['local-only', 'local-audio-cloud-text', 'cloud-audio-and-text', 'cloud-audio-only']),
  queue: z.number().int().nonnegative().max(8), running: z.number().int().nonnegative().max(2),
  gate: AudioGate.nullable().default(null), rejected: z.number().int().nonnegative().default(0),
  segments: z.array(Segment).max(MAX_SEGMENTS), sentAt: z.number(),
  // Content-free recent turn outcomes survive rejected rows, but reset with display generation.
  turns: z.array(TurnTrace).max(MAX_SEGMENTS).default([]),
  turnTelemetryVersion: z.literal(2).optional(),
});
export type Snapshot = z.infer<typeof Snapshot>;
export const SAMPLE_RATE = 24000;
export const FRAME_SAMPLES = 1200; // 50 ms, mono PCM16 little endian
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const CAPTION_TTL_MS = 20_000;
export const HEARTBEAT_TIMEOUT_MS = 6_000;
