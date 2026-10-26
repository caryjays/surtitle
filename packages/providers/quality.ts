import { deflateSync } from 'node:zlib';

// Conservative, language-independent loop detection. This is not a word blacklist:
// normal short repetitions ("yes, yes", counting, Japanese backchannels) survive.
export function isRepetitiveTranscript(text: string): boolean {
  const compact = text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
  if ([...compact].length < 40) return false;
  if (/^(.{1,32})\1{7,}$/u.test(compact)) return true;
  const bytes = Buffer.from(text, 'utf8');
  return bytes.length >= 160 && bytes.length / deflateSync(bytes).length > 4;
}
