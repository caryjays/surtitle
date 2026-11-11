import type { AudioGate, Mode, Pair, Segmentation, Source, Uncaptioned, TranslationInput, Translation, TurnMeasurement, TranslationDiagnostic } from '../protocol/index.ts';

export type TranscriptEvent =
  | { type: 'begin'; id: string; sequence: number; mode?: Mode }
  // stable: how many leading characters of text are locked and never rewritten; absent means all of it is.
  // locked, rolling only: the row's locked audio, the lag of its latest lock (that audio's end to the lock), and the row's
  // language once settled, so the controller can translate locked pieces before the row closes.
  | { type: 'partial'; id: string; text: string; stable?: number; locked?: { audioMs: number; lagMs: number; language: Source } }
  // uncaptioned, with rejected: the row held speech that shows no text, outside the pair or rejected by the filters; it
  // stays as a marker. Without it, a rejected row was non-speech and disappears.
  | { type: 'final'; id: string; text: string; language?: Source; rejected?: boolean; uncaptioned?: Uncaptioned };
export interface Transcriber {
  connect(): Promise<void>;
  audio(pcm: Uint8Array): void;
  finish(): Promise<void>;
  // Optional capabilities. Mode changes commit the current turn using its OLD hint.
  setMode?(mode: Mode): void;
  flush?(): void;
  // Recalibration drops recognition work pending on earlier audio: no event for a turn or row heard before it may follow.
  calibrate?(): void;
  close(): void;
}
export type TranscriberFactory = (options: {
  mode: Mode; pair?: Pair; segmentation?: Segmentation; onEvent: (event: TranscriptEvent) => void; onFailure: () => void;
  onGate?: (gate: AudioGate) => void;
  // The noise gate of the stream this one replaces after an automatic restart; a calibrating recognizer starts from it.
  gateThreshold?: number;
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
  // The session's pair changed; later requests are for it. A translator without this keeps the pair it was built with.
  setPair?(pair: Pair): void;
}
