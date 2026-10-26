import test from 'node:test';
import assert from 'node:assert/strict';
import { isRepetitiveTranscript } from '../packages/providers/quality.ts';

for (const text of ['鮑、'.repeat(60), 'クラス'.repeat(100), 'ギャルスティック '.repeat(30), 'Class, '.repeat(90)]) {
  test('long recognition loops are rejected without language-specific word blacklists', () => {
    assert.equal(isRepetitiveTranscript(text), true);
  });
}
test('short repetition, counting and normal bilingual speech are not rejected', () => {
  for (const text of ['Yes, yes, yes.', 'はい、はい。', 'One, two, three, four.',
    'このモデルの推論速度はどのように測定できますか。実際の利用環境では、精度だけでなく遅延や消費電力も確認する必要があります。',
    'Could you explain how retrieval-augmented generation handles a question about an earlier slide?']) {
    assert.equal(isRepetitiveTranscript(text), false);
  }
});
