import type { AudioGate, Mode, TranslationInput, Translation, TurnMeasurement, TranslationDiagnostic } from '../protocol/index.ts';

export type TranscriptEvent =
  | { type: 'begin'; id: string; sequence: number; mode?: Mode }
  | { type: 'partial'; id: string; text: string }
  | { type: 'final'; id: string; text: string; language?: 'en' | 'ja' | 'unknown'; rejected?: boolean };
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
  mode: Mode; onEvent: (event: TranscriptEvent) => void; onFailure: () => void;
  onGate?: (gate: AudioGate) => void;
  onTurnDiagnostic?: (id: string, measurement: TurnMeasurement) => void;
}) => Transcriber;
export class TranslationFailure extends Error {
  constructor(readonly category: 'translation-auth' | 'translation-rate-limit' | 'translation-network') {
    super(category);
  }
}
export interface Translator {
  translate(input: TranslationInput, signal: AbortSignal, diagnostic?: (value: TranslationDiagnostic) => void): Promise<Translation>;
}
