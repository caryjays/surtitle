import readline from 'node:readline';
// Stands in for scripts/local/translate_worker.py: one generation at a time, cancel by id. Behaviors: normal, slow,
// crash-once (exits on its first request), length, garbage, stream (sends prefixes of its reply first).
const behavior = process.argv[2];
console.log(JSON.stringify({ type: 'ready' }));
const queue = []; const cancelled = new Set(); let busy = false; let requests = 0;
const send = message => console.log(JSON.stringify(message));
function next() {
  if (busy || !queue.length) return;
  const request = queue.shift();
  if (cancelled.has(request.id)) { send({ type: 'cancelled', id: request.id }); next(); return; }
  busy = true;
  const finish = () => {
    busy = false;
    if (cancelled.has(request.id)) send({ type: 'cancelled', id: request.id });
    else {
      const input = JSON.parse(request.user);
      const text = behavior === 'garbage' ? 'Sure! Here is the translation.'
        // echo: with context the source text comes back as its own translation; without, it is translated.
        : behavior === 'echo' && input.context?.length ? JSON.stringify({ source: 'en', target: 'ja', text: input.text })
        : `<think>\n\n</think>\n\n${JSON.stringify({ source: 'en', target: 'ja', text: `[ja] ${input.text}` })}`;
      // Every prefix, as the real worker's throttled partials are; the adapter must tolerate any cut.
      if (behavior === 'stream') for (let k = 1; k < text.length; k++) send({ type: 'partial', id: request.id, text: text.slice(0, k) });
      send({ type: 'result', id: request.id, text, inferenceMs: 5, promptTokens: 300, generationTokens: 20, finish: behavior === 'length' ? 'length' : 'stop' });
    }
    next();
  };
  setTimeout(finish, behavior === 'slow' ? 400 : 5);
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.cancel) { cancelled.add(message.cancel); return; }
  if (behavior === 'crash-once' && ++requests === 1 && !process.env.SECOND) process.exit(1);
  queue.push(message); next();
});
