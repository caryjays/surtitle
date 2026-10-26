import { z } from 'zod';

const ms = z.number().finite().min(0).max(120_000);
const count = z.number().int().min(0).max(10_000);
export const Boundary = z.enum(['silence', 'max-duration', 'flush', 'mode-change', 'pause', 'recalibration']);
export type Boundary = z.infer<typeof Boundary>;
export const RecognitionQuality = z.object({
  speechGateRejected: z.boolean(), decodedSegments: count, droppedSegments: count,
  noSpeechDrops: count, lowConfidenceDrops: count, repetitionDrops: count, invalidScoreDrops: count,
  noSpeechMax: z.number().finite().min(0).max(1).nullable(),
  logprobMin: z.number().finite().min(-100).max(10).nullable(),
}).strict();
export const TurnMeasurement = z.object({
  boundary: Boundary.optional(), audioMs: ms.optional(), trailingQuietMs: ms.optional(),
  recognitionQueueMs: ms.optional(), recognitionInferenceMs: ms.optional(), commitToFinalMs: ms.optional(),
  recognitionLanguage: z.string().regex(/^(?:[a-z]{2,3}|unknown)$/).optional(),
  recognitionClipped: z.boolean().optional(), adapterRepetitionRejected: z.boolean().optional(),
  recognitionFailure: z.enum(['runtime', 'protocol', 'startup-timeout', 'inference-timeout', 'queue-expired']).optional(),
  quality: RecognitionQuality.optional(),
}).strict();
export type TurnMeasurement = z.infer<typeof TurnMeasurement>;
export const TranslationDiagnostic = z.object({
  response: z.enum(['completed', 'incomplete', 'refused', 'invalid', 'http-error', 'network-error']),
  outputTokenLimitReached: z.boolean().optional(),
}).strict();
export type TranslationDiagnostic = z.infer<typeof TranslationDiagnostic>;
export const TurnTrace = TurnMeasurement.extend({
  sequence: z.number().int().nonnegative(), mode: z.enum(['auto', 'en-ja', 'ja-en']),
  outcome: z.enum(['capturing', 'committed', 'rejected', 'empty', 'original', 'translating', 'ready', 'unresolved', 'failed', 'skipped', 'capture-failed']),
  recognitionSource: z.enum(['en', 'ja', 'unknown']).optional(), controllerRepetitionRejected: z.boolean().optional(),
  originalEndsInEllipsis: z.boolean().optional(), translationEndsInEllipsis: z.boolean().optional(),
  translationQueueMs: ms.optional(), translationMs: ms.optional(),
  translationResponse: TranslationDiagnostic.shape.response.optional(), outputTokenLimitReached: z.boolean().optional(),
  translationFailure: z.enum(['request-error', 'timeout', 'queue-full', 'queue-expired']).optional(),
  contextSequences: z.array(z.number().int().nonnegative()).max(4).optional(),
  contextMissingTranslations: z.number().int().min(0).max(4).optional(),
  contextClippedRows: z.number().int().min(0).max(4).optional(),
}).strict();
export type TurnTrace = z.infer<typeof TurnTrace>;

export function endsInEllipsis(text: string): boolean {
  return /(?:\.{3,}|[…⋯]+)[\s"'”’」』）)]*$/u.test(text);
}
