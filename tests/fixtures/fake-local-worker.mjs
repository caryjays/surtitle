import readline from 'node:readline';
const behavior = process.argv[2];
if (behavior !== 'no-ready') console.log(JSON.stringify({ type: 'ready' }));
const lines = readline.createInterface({ input: process.stdin });
let decodes = 0;
// Rolling: voiced test frames hold 6000 and carry their absolute index in the first sample, so words are named by where their
// second of audio starts and stay the same across trimmed windows. The unfinished last second is a tail
// that changes every decode. unstable: every word changes every decode, so nothing ever agrees.
function rolling(request) {
  const pcm = Buffer.from(request.audio, 'base64'); const start = pcm.readInt16LE(0);
  // Speech is the voiced frames up to the first quiet one, as Whisper would not transcribe trailing silence.
  let ms = 0;
  while (ms * 48 + 2400 <= pcm.length && pcm.readInt16LE(ms * 48 + 2) === 6000) ms += 50;
  decodes++;
  const segments = [];
  if (behavior !== 'rolling-noise') {
    for (let k = 0; (k + 1) * 1000 <= ms; k++) {
      segments.push({ endMs: (k + 1) * 1000, text: ` w${start + 20 * k}${behavior === 'rolling-unstable' ? `x${decodes}` : ''}` });
    }
    if (ms % 1000) segments.push({ endMs: Math.floor(ms), text: ` t${decodes}` });
  }
  return { type: 'final', id: request.id, text: segments.map(s => s.text).join('').trim(), language: request.language ?? 'ja',
    inferenceMs: 1, rejected: !segments.length, segments };
}
lines.on('line', line => {
  const request = JSON.parse(line);
  if (behavior.startsWith('rolling')) { setTimeout(() => console.log(JSON.stringify(rolling(request))), 5); return; }
  if (behavior === 'hang' || behavior === 'no-ready') return;
  if (behavior === 'malformed') { console.log('not-json'); return; }
  if (behavior === 'oversized') { console.log('x'.repeat(40_000)); return; }
  setTimeout(() => console.log(JSON.stringify({ type: 'final', id: request.id, text: behavior === 'loop' ? 'クラス'.repeat(100) : behavior === 'rejected' ? '' : 'Local fixture',
    language: request.language ?? 'en', inferenceMs: 1, ...(behavior === 'rejected' ? { rejected: true, segments: [] } : {}),
    ...(behavior === 'normal' ? { segments: [{ endMs: 700, text: 'Local fixture' }] } : {}),
    ...(behavior === 'bad-segments' ? { segments: [{ endMs: -1, text: 'Local fixture' }] } : {}),
    ...(behavior === 'measurement' ? { measurement: { recognitionLanguage: 'ja', recognitionClipped: true,
      quality: { speechGateRejected: false, decodedSegments: 2, droppedSegments: 1, noSpeechDrops: 0,
        lowConfidenceDrops: 1, repetitionDrops: 0, stockPhraseDrops: 0, invalidScoreDrops: 0, noSpeechMax: 0.2, logprobMin: -1.2 } } } : {}),
    ...(behavior === 'bad-measurement' ? { measurement: { transcript: 'must not cross the metadata boundary' } } : {}) })), 5);
});
