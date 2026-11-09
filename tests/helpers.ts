import { Controller } from '../apps/service/controller.ts';
import type { TranscriberFactory, TranscriptEvent, Translator } from '../packages/providers/types.ts';
import type { AudioGate, Mode, Pair, Segmentation, Snapshot, Translation } from '../packages/protocol/index.ts';
export const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
export function harness(extra: { translationTimeoutMs?: number; queueTtlMs?: number; sessionLimitMs?: number | null; pair?: Pair;
  segmentation?: Segmentation; processing?: Snapshot['processing'] } = {}) {
  const streams: { emit(event: TranscriptEvent): void; fail(): void; closed: boolean; segmentation?: Segmentation; frames: number; modes: Mode[]; flushes: number; calibrations: number; gate(gate: AudioGate): void }[] = [];
  const requests: { input: Parameters<Translator['translate']>[0]; signal: AbortSignal; result: ReturnType<typeof deferred<Translation>>;
    partial: NonNullable<Parameters<Translator['translate']>[3]> }[] = [];
  const factory: TranscriberFactory = options => {
    const stream = { emit: options.onEvent, fail: options.onFailure, closed: false, segmentation: options.segmentation, frames: 0, modes: [options.mode], flushes: 0, calibrations: 0, gate: (gate: AudioGate) => options.onGate?.(gate) };
    streams.push(stream);
    return { async connect() {}, audio() { stream.frames++; }, async finish() {}, close() { stream.closed = true; },
      setMode(mode) { stream.modes.push(mode); }, flush() { stream.flushes++; },
      calibrate() { stream.calibrations++; stream.gate({ state: 'calibrating', level: 0, threshold: 0.012, remainingMs: 1500 }); } };
  };
  const controller = new Controller({ transcriber: factory, translator: { translate(input, signal, _diagnostic, partial) {
    const result = deferred<Translation>(); requests.push({ input, signal, result, partial: partial! }); return result.promise;
  } }, glossary: [], backend: 'Fake providers', ...extra });
  let seq = 0;
  const begin = (id: string) => streams.at(-1)!.emit({ type: 'begin', id, sequence: seq++ });
  const final = (id: string, text = 'Hello') => { begin(id); streams.at(-1)!.emit({ type: 'final', id, text }); };
  return { controller, streams, requests, begin, final };
}
export const ja: Translation = { source: 'en', target: 'ja', text: 'こんにちは' };
export const en: Translation = { source: 'ja', target: 'en', text: 'Hello' };
