import { renderSegments } from './client.ts';
import { Pacer } from './pacer.ts';
import { DEFAULT_PAIR, type Segment, type Snapshot } from '../../packages/protocol/index.ts';
import { previewLanguage, previewSegments } from './preview.ts';

// The fictional conversation is in ./preview.ts; it is shown in the session's pair.
export const PREVIEW_SEGMENTS = previewSegments(DEFAULT_PAIR);

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
      || a.source !== b.source || a.target !== b.target || a.state !== b.state || a.final !== b.final || a.translationMs !== b.translationMs
      || a.stable !== b.stable || a.agreed !== b.agreed || a.uncaptioned !== b.uncaptioned) return true;
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
  let latest: Snapshot | undefined;
  const pacer = new Pacer();
  function render() {
    const pair = latest?.pair ?? DEFAULT_PAIR;
    const source = showingPreview ? previewSegments(pair, latest?.script) : rows;
    const visible = filterHistory(source, search.value);
    let shown: Parameters<typeof renderSegments>[1] = visible;
    if (!showingPreview) {
      pacer.configure({ ...pacer.settings, enabled: document.body.dataset.pace !== 'false' });
      const ids = new Set(visible.map(row => row.id));
      shown = pacer.update(latest, Date.now()).filter(row => ids.has(row.id));
    }
    preservePosition(() => renderSegments(captions, shown, true, showingPreview ? [] : turns, latest?.pair, latest?.script));
    const empty = search.value.trim() ? 'No matching recent text. Clear search to see all turns.' : 'Original speech and translations will appear here.';
    if (captions.dataset.emptyMessage !== empty) captions.dataset.emptyMessage = empty;
    document.getElementById('history-count')!.textContent = `${visible.length} / ${source.filter(row => row.original).length} turns · ${showingPreview ? 'fictional preview' : 'recent 60 · memory only'}`;
    preview.setAttribute('aria-pressed', String(showingPreview));
    preview.textContent = showingPreview ? 'Return to live text' : 'Preview long conversation';
    document.getElementById('preview-notice')!.hidden = !showingPreview;
    document.getElementById('preview-pair')!.textContent = `EN/${previewLanguage(pair).toUpperCase()}`;
  }
  function browse() { follow.checked = false; render(); captions.scrollTop = 0; }
  preview.addEventListener('click', () => { showingPreview = !showingPreview; search.value = ''; browse(); });
  search.addEventListener('input', browse);
  document.getElementById('latest')!.addEventListener('click', () => { search.value = ''; render(); });
  document.getElementById('search-clear')!.addEventListener('click', () => { search.value = ''; browse(); search.focus(); });
  // Keep releasing paced text between snapshots.
  setInterval(() => { if (pacer.busy && !showingPreview) render(); }, 100);
  return (snapshot: Snapshot) => {
    const changed = readingContentChanged(previous, snapshot);
    previous = snapshot; latest = snapshot;
    rows = snapshot.segments; turns = snapshot.turns;
    const capturing = ['connecting', 'active', 'stopping'].includes(snapshot.capture);
    preview.disabled = capturing;
    const exitPreview = capturing && showingPreview;
    if (exitPreview) { showingPreview = false; search.value = ''; follow.checked = true; }
    if (exitPreview || (changed && !showingPreview)) render();
  };
}
