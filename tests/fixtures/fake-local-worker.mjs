import readline from 'node:readline';
const behavior = process.argv[2];
if (behavior !== 'no-ready') console.log(JSON.stringify({ type: 'ready' }));
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const request = JSON.parse(line);
  if (behavior === 'hang' || behavior === 'no-ready') return;
  if (behavior === 'malformed') { console.log('not-json'); return; }
  if (behavior === 'oversized') { console.log('x'.repeat(40_000)); return; }
  setTimeout(() => console.log(JSON.stringify({ type: 'final', id: request.id, text: behavior === 'loop' ? 'クラス'.repeat(100) : behavior === 'rejected' ? '' : 'Local fixture',
    language: request.language ?? 'en', inferenceMs: 1, ...(behavior === 'rejected' ? { rejected: true } : {}),
    ...(behavior === 'measurement' ? { measurement: { recognitionLanguage: 'ja', recognitionClipped: true,
      quality: { speechGateRejected: false, decodedSegments: 2, droppedSegments: 1, noSpeechDrops: 0,
        lowConfidenceDrops: 1, repetitionDrops: 0, invalidScoreDrops: 0, noSpeechMax: 0.2, logprobMin: -1.2 } } } : {}),
    ...(behavior === 'bad-measurement' ? { measurement: { transcript: 'must not cross the metadata boundary' } } : {}) })), 5);
});
