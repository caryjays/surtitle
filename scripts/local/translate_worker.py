"""Private stdio RPC for local translation: stdout is protocol only; no transcript diagnostic logs.

Requests are JSON lines {id, system, user, maxTokens}, or {cancel: id} to stop a queued or running request.
While a request generates, {type: 'partial', id, text} carries its reply so far, at most every PARTIAL_S.
Each request then gets exactly one reply, {type: 'result', ...} or {type: 'cancelled', id}."""
import json
import pathlib
import queue
import sys
import threading
import time

from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODELS = json.loads((ROOT / 'scripts/local/translators.json').read_text())
lock = threading.Lock()
PARTIAL_S = 0.1


def send(message):
    with lock:
        sys.stdout.write(json.dumps(message, ensure_ascii=False) + '\n')
        sys.stdout.flush()


def valid(request):
    return (set(request) == {'id', 'system', 'user', 'maxTokens'} and isinstance(request['id'], str) and len(request['id']) <= 100
            and isinstance(request['system'], str) and len(request['system']) <= 20_000
            and isinstance(request['user'], str) and len(request['user']) <= 40_000
            and isinstance(request['maxTokens'], int) and 1 <= request['maxTokens'] <= 2048)


def main():
    name = sys.argv[1]
    if name not in MODELS:
        raise ValueError('Unknown translation model')
    model, tokenizer = load(str(ROOT / '.local/models' / name))
    sampler = make_sampler(temp=0.0)

    def generate(system, user, max_tokens, stop=lambda: False, progress=lambda text: None):
        # Thinking off: a caption needs the answer, not a reasoning preamble.
        prompt = tokenizer.encode(tokenizer.apply_chat_template(
            [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            tokenize=False, add_generation_prompt=True, enable_thinking=False), add_special_tokens=False)
        text, last, sent = '', None, time.perf_counter()
        for last in stream_generate(model, tokenizer, prompt, max_tokens=max_tokens, sampler=sampler):
            text += last.text
            if stop():
                return None, last
            if time.perf_counter() - sent >= PARTIAL_S:
                progress(text)
                sent = time.perf_counter()
        return text, last

    # Compile and warm before the first caption.
    generate('Reply with one word.', 'Ready?', 4)
    send({'type': 'ready'})

    requests, cancelled = queue.Queue(), set()

    def read():
        while line := sys.stdin.buffer.readline(100_001):
            if len(line) > 100_000 or not line.endswith(b'\n'):
                break
            request = json.loads(line)
            if set(request) == {'cancel'} and isinstance(request['cancel'], str):
                cancelled.add(request['cancel'])
            elif valid(request):
                requests.put(request)
            else:
                break
        requests.put(None)

    threading.Thread(target=read, daemon=True).start()
    while (request := requests.get()) is not None:
        if request['id'] in cancelled:
            cancelled.discard(request['id'])
            send({'type': 'cancelled', 'id': request['id']})
            continue
        start = time.perf_counter()
        text, last = generate(request['system'], request['user'], request['maxTokens'], lambda: request['id'] in cancelled,
                              lambda text: send({'type': 'partial', 'id': request['id'], 'text': text}))
        if text is None:
            cancelled.discard(request['id'])
            send({'type': 'cancelled', 'id': request['id']})
            continue
        send({'type': 'result', 'id': request['id'], 'text': text, 'inferenceMs': round((time.perf_counter() - start) * 1000),
              'promptTokens': last.prompt_tokens if last else 0, 'generationTokens': last.generation_tokens if last else 0,
              'finish': (last.finish_reason if last else None) or 'stop'})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        send({'type': 'error'})
        raise SystemExit(1)
