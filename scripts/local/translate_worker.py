"""Private stdio RPC for local translation: stdout is protocol only; no transcript diagnostic logs.

Requests are JSON lines {id, system, user, maxTokens}, or {cancel: id} to stop a queued or running request.
While a request generates, {type: 'partial', id, text} carries its reply so far, at most every PARTIAL_S.
Each request then gets exactly one reply, {type: 'result', ...} or {type: 'cancelled', id}.

With --prompt-cache after the model name, the model state for a start that prompts share, the instructions and usually
the glossary, is computed once and copied for each request instead of being computed again. The adapter passes it unless told not to."""
import copy
import json
import pathlib
import queue
import sys
import threading
import time

import mlx.core as mx
from mlx_lm import load, stream_generate
from mlx_lm.models.cache import make_prompt_cache
from mlx_lm.sample_utils import make_sampler

from prefix_cache import Prefixes

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
    name, flags = sys.argv[1], sys.argv[2:]
    if name not in MODELS or any(flag != '--prompt-cache' for flag in flags):
        raise ValueError('Unknown translation model or option')
    model, tokenizer = load(str(ROOT / '.local/models' / name))
    sampler = make_sampler(temp=0.0)
    prefixes, states = (Prefixes(), {}) if flags else (None, {})

    def state_for(prompt):
        """The prompt still to run and a copy of the stored state before it, or the whole prompt and None."""
        if prefixes is None:
            return prompt, None
        key, length, learn = prefixes.plan(prompt)
        if learn:
            state = copy.deepcopy(states[key]) if key is not None else make_prompt_cache(model)
            model(mx.array(prompt[length:learn])[None], cache=state)
            mx.eval([c.state for c in state])
            key, evicted = prefixes.add(prompt[:learn])
            states[key], length = state, learn
            for old in evicted:
                del states[old]
        if key is None:
            return prompt, None
        return prompt[length:], copy.deepcopy(states[key])

    def generate(system, user, max_tokens, stop=lambda: False, progress=lambda text: None):
        # Thinking off: a caption needs the answer, not a reasoning preamble.
        prompt = tokenizer.encode(tokenizer.apply_chat_template(
            [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
            tokenize=False, add_generation_prompt=True, enable_thinking=False), add_special_tokens=False)
        text, last, sent = '', None, time.perf_counter()
        total = len(prompt)
        prompt, state = state_for(prompt)
        for last in stream_generate(model, tokenizer, prompt, max_tokens=max_tokens, sampler=sampler,
                                    **({'prompt_cache': state} if state is not None else {})):
            last.prompt_tokens = total  # the whole prompt, whatever part of it was reused
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
