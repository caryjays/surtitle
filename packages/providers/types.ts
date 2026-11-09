import type { AudioGate, Mode, Pair, Segmentation, Source, TranslationInput, Translation, TurnMeasurement, TranslationDiagnostic } from '../protocol/index.ts';

export type TranscriptEvent =
  | { type: 'begin'; id: string; sequence: number; mode?: Mode }
  // stable: how many leading characters of text are locked and never rewritten; absent means all of it is.
  | { type: 'partial'; id: string; text: string; stable?: number }
  | { type: 'final'; id: string; text: string; language?: Source; rejected?: boolean };
export interface Transcriber {
  connect(): Promise<void>;
  audio(pcm: Uint8Array): void;
  finish(): Promise<void>;
  // Optional capabilities. Mode changes commit the current turn using its OLD hint.
  setMode?(mode: Mode): void;
  flush?(): void;
  calibrate?(): void;
  close(): void;
}
export type TranscriberFactory = (options: {
  mode: Mode; pair?: Pair; segmentation?: Segmentation; onEvent: (event: TranscriptEvent) => void; onFailure: () => void;
  onGate?: (gate: AudioGate) => void;
  onTurnDiagnostic?: (id: string, measurement: TurnMeasurement) => void;
}) => Transcriber;
export class TranslationFailure extends Error {
  constructor(readonly category: 'translation-auth' | 'translation-rate-limit' | 'translation-network') {
    super(category);
  }
}
// A translation still generating: its text so far, which later partials and the result only extend or replace.
export type PartialTranslation = { source: Source; target: Source; text: string };
export interface Translator {
  // partial: translators that stream report the text so far; the returned translation is still the only validated one.
  translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void,
    partial?: (value: PartialTranslation) => void): Promise<Translation>;
}
