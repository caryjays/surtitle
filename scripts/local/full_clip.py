"""Transcribe a whole recording in one call: Whisper's own 30 s windows, no energy turns, no 12 s cap.

Uses the live model and decode settings, so a comparison with segmented replay isolates segmentation.
--condition also tries Whisper's long-form default of conditioning on previous text. Offline only;
write output under private/ for personal or third-party recordings.
"""
import argparse
import json
import subprocess
import time
import numpy as np
import mlx.core as mx
import mlx_whisper
from engine import Engine
from quality import accepted_result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--model', choices=['small-q4', 'turbo-q4'], default='turbo-q4')
    args = parser.parse_args()
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', args.audio, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'],
                         check=True, capture_output=True).stdout
    audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    engine = Engine(args.model)
    runs = {}
    for name, condition in (('live-settings', False), ('condition-previous', True)):
        start = time.perf_counter()
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=str(engine.path), language=None, task='transcribe',
                                        temperature=0.0, condition_on_previous_text=condition, verbose=None,
                                        word_timestamps=False, fp16=True)
        mx.synchronize()
        seconds = time.perf_counter() - start
        filtered, rejected, quality = accepted_result(result, min_logprob=-1.0)
        runs[name] = {
            'seconds': seconds, 'language': result.get('language'), 'text': result['text'].strip(),
            'filteredText': filtered, 'filterRejectedAll': rejected, 'quality': quality,
            'segments': [{'start': round(s['start'], 2), 'end': round(s['end'], 2), 'text': s['text'].strip(),
                          'avgLogprob': round(s['avg_logprob'], 3), 'noSpeechProb': round(s['no_speech_prob'], 3)}
                         for s in result['segments']],
        }
        print(f'{name}: {seconds:.1f}s, language {result.get("language")}, {len(result["segments"])} segments, '
              f'{len(result["text"].strip())} chars raw, {len(filtered)} after live filters', flush=True)
    with open(args.out, 'w') as handle:
        json.dump({'audioSeconds': len(audio) / 16000, 'model': args.model, 'runs': runs}, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


if __name__ == '__main__':
    main()
