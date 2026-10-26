import { PcmResampler } from './audio.ts';
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class CaptureProcessor extends AudioWorkletProcessor {
  private resampler = new PcmResampler(sampleRate, (pcm, rms) => this.port.postMessage({ pcm, rms }, [pcm]));
  process(inputs: Float32Array[][]) { this.resampler.push(inputs[0] ?? []); return true; }
}
registerProcessor('pcm-capture', CaptureProcessor);
