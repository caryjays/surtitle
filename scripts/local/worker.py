"""Private stdio RPC: stdout is protocol only; no audio/transcript diagnostic logs."""
import base64
import json
import re
import sys
from engine import Engine


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main(engine_factory=Engine):
    # Factory injection is for the explicit offline experiment worker, never RPC/config input.
    engine = engine_factory(sys.argv[1])
    # Compile/warm inference before capture, not on the first audience utterance.
    engine.warm()
    send({'type': 'ready'})
    while True:
        line = sys.stdin.buffer.readline(900_001)
        if not line:
            return
        if len(line) > 900_000 or not line.endswith(b'\n'):
            raise ValueError('Invalid RPC frame')
        request = json.loads(line)
        if set(request) not in ({'id', 'audio', 'language'}, {'id', 'audio', 'language', 'prompt'}) or not isinstance(request['id'], str) or len(request['id']) > 100:
            raise ValueError('Invalid RPC request')
        pcm = base64.b64decode(request['audio'], validate=True)
        result = engine.transcribe(pcm, request['language'], request.get('prompt'))
        send({'type': 'final', 'id': request['id'], 'text': result['text'],
              'language': result['language'] if result['language'] in ('en', 'ja') else 'unknown',
              'inferenceMs': round(result['seconds'] * 1000), 'rejected': result['rejected'],
              'measurement': {'recognitionLanguage': result['language'] if isinstance(result['language'], str)
                              and re.fullmatch('[a-z]{2,3}', result['language']) else 'unknown',
                              'recognitionClipped': result['clipped'], 'quality': result['quality']}})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        send({'type': 'error'})
        raise SystemExit(1)
