import { renderSegments } from './client.ts';
import type { Segment, Snapshot } from '../../packages/protocol/index.ts';

// Authored fictional display fixtures only: never submitted to ASR, translation or canonical state.
const examples = [
  ['en', 'Before we begin, could you explain how this companion handles a longer conversation? I would like to read the English translation while still being able to look back at the original Japanese, especially when a speaker introduces an unfamiliar technical term.',
    '始める前に、このアプリが長い会話をどのように扱うか説明していただけますか。特に話し手が聞き慣れない専門用語を使ったとき、英訳を読みながら日本語の原文も振り返りたいです。'],
  ['ja', 'はい。ここでは一つの発言ごとに原文と翻訳を並べています。短い返事だけでなく、いくつかの文が続く説明もあります。文字を小さくすると前後の流れを一度に見渡しやすくなりますが、離れた場所から読む場合は大きい文字のほうが便利です。',
    'Yes. Each turn keeps its original and translation together. Some turns are short replies; others contain several sentences. Smaller text makes it easier to see the surrounding discussion at once, while larger text is more useful when reading from a distance.'],
  ['en', 'That makes sense. Let us try a practical example: imagine a lecture about keeping a personal knowledge base. The speaker describes collecting notes, connecting related ideas, and reviewing old decisions. A useful translation should preserve those distinctions instead of turning every idea into a generic summary.',
    'なるほど。実際の例を試しましょう。個人用の知識ベースについての講演を想像してください。話し手は、メモを集め、関連する考えを結び付け、過去の判断を振り返ることを説明しています。役に立つ翻訳では、すべてを一般的な要約にするのではなく、それぞれの違いを保つ必要があります。'],
  ['ja', '講演の途中で、前の説明に戻りたいこともありますね。たとえば「その判断」という言葉が何を指すか確認するために、少し前の発言を探します。新しい文章が届いても、読んでいる場所が勝手に一番下へ移動しないことが大切です。',
    'During a lecture, you may want to return to an earlier explanation. For example, you might look back a few turns to check what “that decision” refers to. It matters that new text does not pull you to the bottom while you are reading an earlier passage.'],
  ['ja', 'もう一つ質問があります。英語の質問に日本語で答えたあと、同じ人が続けて日本語で補足した場合はどうなりますか。会話は必ずしも二つの言語が交互に現れるとは限りません。',
    'I have another question. What happens if someone answers an English question in Japanese and then adds another explanation in Japanese? Conversations do not necessarily alternate between the two languages.'],
  ['en', 'Exactly. This preview includes consecutive Japanese turns as well as English questions. Try searching for “lecture” or “日本語”, switching to compact spacing, and comparing a narrow reading column with the full window. These are fictional examples for checking the layout, not measured translation results.',
    'そのとおりです。このプレビューには、英語の質問だけでなく、日本語が続く発言も含まれています。「lecture」や「日本語」を検索し、間隔をコンパクトにして、狭い表示幅とウィンドウ全体の幅を比べてみてください。これはレイアウト確認用の架空の例で、翻訳性能を測定した結果ではありません。'],
  ['ja', '読みやすさは文字の大きさだけでは決まりません。行間、段落の余白、一行の長さも影響します。長い説明を読むときは少し狭い幅が合う人もいますし、会話の全体像を見たいときは広い幅が合う人もいます。\n\nこの段落のように改行が含まれる場合も、全文を省略せずに確認できると便利です。',
    'Readability depends on more than font size. Line spacing, padding, and line length also matter. Some people prefer a narrower column for long explanations; others prefer a wider view to see more of the conversation.\n\nWhen a turn contains paragraph breaks like this one, it is useful to be able to read the whole passage without truncation.'],
  ['en', 'Thank you. I will try the smaller sizes first, then increase the translation size until it feels comfortable. After that I can leave the preview, return to the real recent history, and start the microphone when I am ready. None of this sample conversation should become translation context.',
    'ありがとうございます。まず小さい文字を試してから、読みやすくなるまで翻訳の文字を大きくしてみます。その後プレビューを終了して実際の直近の履歴に戻り、準備ができたらマイクを開始できます。このサンプル会話が翻訳の文脈に入ることはありません。'],
] as const;

export const PREVIEW_SEGMENTS: Segment[] = examples.map(([source, original, translation], sequence) => ({
  id: `layout-preview-${sequence}`, sequence, original, translation, source, target: source === 'en' ? 'ja' : 'en',
  final: true, state: 'ready', finalizedAt: null, translationMs: null,
}));

export function filterHistory(rows: Segment[], query: string): Segment[] {
  const text = query.trim().normalize('NFKC').toLocaleLowerCase();
  return rows.filter(row => row.original && (!text || `${row.original}\n${row.translation ?? ''}`.normalize('NFKC').toLocaleLowerCase().includes(text)));
}

// Gate/meter/heartbeat updates must not rewrite 60 captions or measure their layout.
export function readingContentChanged(before: Pick<Snapshot, 'segments' | 'turns'> | undefined, after: Pick<Snapshot, 'segments' | 'turns'>): boolean {
  if (!before || before.segments.length !== after.segments.length || before.turns.length !== after.turns.length) return true;
  for (let i = 0; i < after.segments.length; i++) {
    const a = before.segments[i]!; const b = after.segments[i]!;
    if (a.id !== b.id || a.sequence !== b.sequence || a.original !== b.original || a.translation !== b.translation
      || a.source !== b.source || a.target !== b.target || a.state !== b.state || a.final !== b.final || a.translationMs !== b.translationMs) return true;
  }
  for (let i = 0; i < after.turns.length; i++) {
    const a = before.turns[i]!; const b = after.turns[i]!;
    if (a.sequence !== b.sequence || a.boundary !== b.boundary || a.audioMs !== b.audioMs
      || a.quality?.droppedSegments !== b.quality?.droppedSegments || a.recognitionClipped !== b.recognitionClipped) return true;
  }
  return false;
}

export function setupHistory(preservePosition: (update: () => void) => void) {
  const captions = document.getElementById('captions')!;
  const search = document.getElementById('history-search') as HTMLInputElement;
  const preview = document.getElementById('layout-preview') as HTMLButtonElement;
  const follow = document.getElementById('follow') as HTMLInputElement;
  let rows: Segment[] = [];
  let turns: Snapshot['turns'] = [];
  let showingPreview = false;
  let previous: Pick<Snapshot, 'segments' | 'turns'> | undefined;
  function render() {
    const source = showingPreview ? PREVIEW_SEGMENTS : rows;
    const visible = filterHistory(source, search.value);
    preservePosition(() => renderSegments(captions, visible, true, showingPreview ? [] : turns));
    captions.dataset.emptyMessage = search.value.trim() ? 'No matching recent text. Clear search to see all turns.' : 'Original speech and translations will appear here.';
    document.getElementById('history-count')!.textContent = `${visible.length} / ${source.filter(row => row.original).length} turns · ${showingPreview ? 'fictional preview' : 'recent 60 · memory only'}`;
    preview.setAttribute('aria-pressed', String(showingPreview));
    preview.textContent = showingPreview ? 'Return to live text' : 'Preview long conversation';
    document.getElementById('preview-notice')!.hidden = !showingPreview;
  }
  function browse() { follow.checked = false; render(); captions.scrollTop = 0; }
  preview.addEventListener('click', () => { showingPreview = !showingPreview; search.value = ''; browse(); });
  search.addEventListener('input', browse);
  document.getElementById('latest')!.addEventListener('click', () => { search.value = ''; render(); });
  document.getElementById('search-clear')!.addEventListener('click', () => { search.value = ''; browse(); search.focus(); });
  return (snapshot: Snapshot) => {
    const changed = readingContentChanged(previous, snapshot);
    previous = snapshot;
    rows = snapshot.segments; turns = snapshot.turns;
    const capturing = ['connecting', 'active', 'stopping'].includes(snapshot.capture);
    preview.disabled = capturing;
    const exitPreview = capturing && showingPreview;
    if (exitPreview) { showingPreview = false; search.value = ''; follow.checked = true; }
    if (exitPreview || (changed && !showingPreview)) render();
  };
}
