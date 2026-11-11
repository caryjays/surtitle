# Translation latency: prompt cache in, speculation out, and a target

2026-11-11, after [the outlier talk and settle pair](2026-11-11-outlier-talk-and-settle-pair.md). The maintainer's rehearsals keep finding translations late, and no gate target covered it. This entry reviews where the delay is, tests two levers and sets a target. Local models only. All numbers are content-free aggregates.

## Where the delay is

From the middle of a row to its first translated text, 6.5 to 8 s at the median in real-time replays: about 3 s waiting for the row to end, about 2 s from the end of speech to final text, about 2 s of translation on the shared GPU. The first part is structural to translating whole sentences between English and Japanese; shorter rows cut its tail and not its median ([row length](2026-11-08-row-length.md)), and pieces read worse ([piece quality](2026-11-10-piece-quality.md)). So the levers are in the last 4 s, and the measure to target is the row's last word to its first translated text.

## Prompt cache

Live translation prompts in a replay of four held-out talks: 573, 651 and 746 tokens at p10, p50 and p90, for replies of 36 tokens at the median. The worker computed all of it for every request.

The worker now keeps the model state of the start that prompts share and copies it for each request. `scripts/local/prefix_cache.py` is the bookkeeping, with unit tests: a start is learned when two prompts share at least 64 tokens, up to four are kept, and a stored one is extended when a longer shared start appears.

Alone on the GPU, three synthetic prompts with the example glossary and a shared start of 433 tokens: time to first token 0.6 to 0.9 s without the cache and 0.1 to 0.2 s with it; whole request 1.3 to 1.8 s against 0.9 to 1.3 s.

`pnpm eval:translation --candidate mlx:qwen3.5-4b-q4 --no-judge`, 36 public cases, 2 repeats, without and with the cache: 72 of 72 valid both ways, 33 of 67 terms both ways, request time p50 1.31 s against 1.09 s. 64 of 72 outputs were identical; the others, read by the agent, were rewordings of equal meaning. A first version relearned a longer start on every near-duplicate case and saved 0.13 s; extending from the stored start fixed that.

Real-time replay, `pnpm replay:contention --translate local` on two English and two Japanese held-out talks, without the cache and then with it, load average about 2. Medians in seconds, without then with:

| Talk | Request to first translated text | Last word to first translated text, p50 (p90) | Speech end to final text | Failed or unresolved rows |
| --- | --- | --- | --- | --- |
| held-en-4320211 | 1.6, 1.1 | 3.6 (4.8), 3.3 (4.4) | 2.0, 2.1 | 1, 0 |
| held-en-4346818 | 1.3, 1.1 | 3.1 (4.0), 3.1 (4.8) | 1.8, 1.8 | 0, 0 |
| held-ja--6K2nN9aWsg | 1.2, 0.7 | 2.9 (4.0), 2.1 (3.9) | 1.6, 1.4 | 2, 1 |
| held-ja-0jJLyvNn_to | 1.1, 0.7 | 3.0 (4.5), 2.6 (3.4) | 1.8, 1.8 | 1, 0 |

Recognition error, scored from the review files, moved by under 0.7 points either way. One pair, cached run second.

The cache is on by default. `promptCache: false` on the adapter, and `--no-prompt-cache` on the replay and eval scripts, turn it off.

## Speculative translation

The idea: when a stretch closes, start translating the text held at that moment, locked text and the last decode's unlocked rest, and keep the request if the final text turns out the same, saving the closing decode's wait.

In the simulator, `held_out_sim.py` over five talks, the held text equalled the final at 117 stretch closes, was a prefix of it at 16 and differed at 25, with 1.0 to 1.2 s saved at the median when equal.

Built behind a replay-only flag and replayed in real time with the cache on: 81 guesses started, 18 kept, 63 stopped. Why so few matched against the simulator's share was not traced. The stopped requests still ran on the GPU beside the closing decode, whose inference rose from about 1.1 s to 1.2 to 1.6 s at the median. Last word to first translated text, median, cache alone then with speculation: 3.3, 3.5; 3.1, 3.4; 2.1, 3.7; 2.6, 2.5. Rejected, and the code is removed; the simulator keeps its counter.

A side finding of the first measuring replay: 84 of 116 rows closed by a pause had shown no text before their final.

## Target

For the offline profile, per talk: a row's last word to its first translated text, median at most 3.0 s and p90 at most 4.5 s; [gates](../wiki/gates.md) part 6. With the cache, this pair meets it on both Japanese talks; the English talks are at 3.3 s and 3.1 s at the median, and one has a p90 of 4.8 s.

## Open

- What is left after the closing quiet of 0.7 s, which fragmentation argues against shortening: the closing decode waits 0.3 to 0.8 s behind a rolling decode in flight, and runs 1.1 s. Superseding the decode in flight is the next thing to try.
- A length close could take the fresh decode's text instead of waiting for a lock, from the row-length entry.
- The cache with a session that changes direction often: each direction learns its own start, which the replays, one language per talk, did not exercise much.
