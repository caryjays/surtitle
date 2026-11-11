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
  // misheard: Auto detection on under 2.5 s of speech picks English, and decoding in English yields only filtered text.
  // misheard-pass: the same, except the short opening decodes once to an accepted English word that never settles.
  const misheard = (behavior === 'rolling-misheard' || behavior === 'rolling-misheard-pass')
    && (request.language === 'en' || (!request.language && ms < 2500));
  if (behavior === 'rolling-misheard-pass' && misheard && !request.language) {
    return { type: 'final', id: request.id, text: 'It', language: 'en', inferenceMs: 1, rejected: false, segments: [{ endMs: ms, text: ' It' }] };
  }
  // after-noise-*: the first 5 s of a stretch are noise with no segments; then two decodes agree on a word, with the
  // confidence of a hallucination (-0.7) or of speech (-0.2).
  if (behavior.startsWith('rolling-after-noise')) {
    const noise = start < 100; const logprobMin = behavior.endsWith('hallucination') ? -0.7 : -0.2;
    const segments = noise ? [] : [{ endMs: Math.max(0, Math.floor(ms) - 1500), text: ' Period.' }];
    return { type: 'final', id: request.id, text: noise ? '' : 'Period.', language: request.language ?? 'en', inferenceMs: 1,
      rejected: noise, segments, measurement: { quality: { speechGateRejected: false, decodedSegments: segments.length,
        droppedSegments: 0, noSpeechDrops: 0, lowConfidenceDrops: 0, repetitionDrops: 0, stockPhraseDrops: 0, invalidScoreDrops: 0,
        noSpeechMax: 0, logprobMin: noise ? null : logprobMin } } };
  }
  // filtered: speech the filters reject on every decode, a loop over audible speech.
  if (behavior === 'rolling-filtered') {
    return { type: 'final', id: request.id, text: '', language: request.language ?? 'ja', inferenceMs: 1, rejected: true, segments: [],
      measurement: { quality: { speechGateRejected: false, decodedSegments: 1, droppedSegments: 1, noSpeechDrops: 0, lowConfidenceDrops: 0,
        repetitionDrops: 1, stockPhraseDrops: 0, invalidScoreDrops: 0, noSpeechMax: 0, logprobMin: -0.2 } } };
  }
  // loop: the whole speech is one segment that never settles, and the decode of a 4 to 5 s window loops and is filtered.
  if (behavior === 'rolling-loop') {
    const words = Array.from({ length: Math.ceil(ms / 1000) }, (_, k) => ` w${start + 20 * k}`).join('');
    const loop = ms >= 4000 && ms < 5000;
    return { type: 'final', id: request.id, text: loop ? '' : words.trim(), language: request.language ?? 'ja', inferenceMs: 1,
      rejected: loop || !words, segments: loop || !words ? [] : [{ endMs: Math.floor(ms), text: words }] };
  }
  // alternate: noise that Auto hears as a stock word in the pair on even seconds and as text outside the pair on odd ones.
  if (behavior === 'rolling-alternate') {
    const off = Math.floor(ms / 1000) % 2 === 1;
    const segments = ms >= 1000 ? [{ endMs: 1000, text: off ? ' Tak' : ' You' }] : [];
    return { type: 'final', id: request.id, text: segments.map(s => s.text).join('').trim(), language: off ? 'pl' : 'en', inferenceMs: 1,
      rejected: !segments.length, segments };
  }
  // switch: Japanese up to frame 100, then English with no pause. Decoding English as Japanese yields only low-confidence
  // text, which the filters drop; Auto on a window that starts in the English hears English.
  if (behavior === 'rolling-switch') {
    const english = start >= 100;
    const segments = [];
    for (let k = 0; (k + 1) * 1000 <= ms; k++) {
      if ((start + 20 * k >= 100) === english && !(english && request.language === 'ja')) segments.push({ endMs: (k + 1) * 1000, text: ` ${english ? 'e' : 'w'}${start + 20 * k}` });
    }
    const dropped = english && request.language === 'ja' ? 1 : 0;
    return { type: 'final', id: request.id, text: segments.map(s => s.text).join('').trim(), language: request.language ?? (english ? 'en' : 'ja'),
      inferenceMs: 1, rejected: !segments.length, segments, measurement: { quality: { speechGateRejected: false,
        decodedSegments: segments.length + dropped, droppedSegments: dropped, noSpeechDrops: 0, lowConfidenceDrops: dropped, repetitionDrops: 0,
        stockPhraseDrops: 0, invalidScoreDrops: 0, noSpeechMax: 0, logprobMin: dropped ? -1.7 : -0.2 } } };
  }
  // third: Auto detection always picks a language outside the pair, with text that would otherwise lock.
  // third-opening: only the first 2.5 s of a row are detected outside the pair, then the speech is Japanese.
  const other = !request.language && (behavior === 'rolling-third' || (behavior === 'rolling-third-opening' && ms < 2500));
  if (behavior !== 'rolling-noise' && !misheard) {
    for (let k = 0; (k + 1) * 1000 <= ms; k++) {
      segments.push({ endMs: (k + 1) * 1000, text: ` w${start + 20 * k}${behavior === 'rolling-unstable' ? `x${decodes}` : ''}${behavior === 'rolling-clauses' && (start / 20 + k) % 2 ? '、' : ''}` });
    }
    if (ms % 1000) segments.push({ endMs: Math.floor(ms), text: ` t${decodes}` });
  }
  return { type: 'final', id: request.id, text: segments.map(s => s.text).join('').trim(), language: misheard ? 'en' : other ? 'ko' : request.language ?? 'ja',
    inferenceMs: 1, rejected: !segments.length, segments,
    ...(behavior.startsWith('rolling-third') ? { measurement: { quality: { speechGateRejected: false, decodedSegments: segments.length,
      droppedSegments: 0, noSpeechDrops: 0, lowConfidenceDrops: 0, repetitionDrops: 0, stockPhraseDrops: 0, invalidScoreDrops: 0,
      noSpeechMax: 0, logprobMin: -0.2, pairRetries: 0, otherLanguageDrops: 0 } } } : {}) };
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
