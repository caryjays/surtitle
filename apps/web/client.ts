import { Snapshot } from '../../packages/protocol/index.ts';
export function connect(role: 'control' | 'overlay', onState: (state: Snapshot) => void, onConnection: (connected: boolean) => void) {
  let socket: WebSocket;
  function open() {
    socket = new WebSocket(`ws://${location.host}/ws/${role}`);
    socket.onopen = () => onConnection(true);
    socket.onmessage = event => {
      try { onState(Snapshot.parse(JSON.parse(String(event.data)))); }
      catch { socket.close(1008, 'Invalid state'); }
    };
    socket.onclose = () => { onConnection(false); setTimeout(open, 1500); };
    socket.onerror = () => socket.close();
  }
  open();
  return {
    send(value: unknown) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); },
    audio(pcm: ArrayBuffer) {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 48_000) return false;
      socket.send(pcm); return true;
    },
  };
}
// Released text, then for the operator the text not released yet in a lighter style. The overlay never gets the rest.
function fill(element: HTMLElement, shown: string, rest: string) {
  let [released, pending] = [...element.children] as HTMLElement[];
  if (!released || !pending) {
    released = document.createElement('span'); pending = document.createElement('span'); pending.className = 'rest';
    element.replaceChildren(released, pending);
  }
  if (released.textContent !== shown) released.textContent = shown;
  if (pending.textContent !== rest) pending.textContent = rest;
}
type Row = Snapshot['segments'][number] & { originalRest?: string; translationRest?: string };
export function renderSegments(container: HTMLElement, rows: Row[], operator = false, turns: Snapshot['turns'] = []) {
  const existing = new Map([...container.children].map(node => [(node as HTMLElement).dataset.id, node as HTMLElement]));
  const keep = new Set<string>();
  let position = 0;
  for (const row of rows.filter(r => r.original || (operator && r.originalRest))) {
    keep.add(row.id);
    let article = existing.get(row.id);
    if (!article) {
      article = document.createElement('article'); article.dataset.id = row.id;
      article.innerHTML = '<div class="original"></div><small></small>';
      container.append(article);
    }
    // Filtering and restoring history can reintroduce earlier rows. Keep canonical order.
    if (container.children[position] !== article) container.insertBefore(article, container.children[position] ?? null);
    position++;
    if (article.dataset.state !== row.state) article.dataset.state = row.state;
    if (article.dataset.sequence !== String(row.sequence)) article.dataset.sequence = String(row.sequence);
    const original = article.querySelector<HTMLElement>('.original')!;
    fill(original, row.original, operator ? row.originalRest ?? '' : '');
    const sourceLanguage = row.source === 'unknown' ? '' : row.source;
    if (original.lang !== sourceLanguage) original.lang = sourceLanguage;
    const info = article.querySelector('small')!;
    let translated = article.querySelector<HTMLElement>('.translation');
    const translationRest = operator ? row.translationRest ?? '' : '';
    if (row.translation || translationRest) {
      if (!translated) {
        translated = document.createElement('div'); translated.className = 'translation';
        article.insertBefore(translated, info);
      }
      fill(translated, row.translation ?? '', translationRest);
      const targetLanguage = row.target === 'unknown' ? '' : row.target;
      if (translated.lang !== targetLanguage) translated.lang = targetLanguage;
    } else translated?.remove();
    if (info.hidden !== !operator) info.hidden = !operator;
    const labels = { partial: 'Provisional original · waiting for final', pending: 'Translating…', ready: 'Translated',
      failed: 'Translation unavailable · original preserved', unresolved: 'Language uncertain · original preserved',
      skipped: 'Translation skipped · backlog or recalibration', original: 'Original only · translation off' };
    const turn = operator ? turns.find(turn => turn.sequence === row.sequence) : undefined;
    const boundaries = { silence: 'quiet boundary', 'max-duration': 'time-limit split · may continue', length: 'row length · speech continues', flush: 'manual flush', 'mode-change': 'direction change', pause: 'capture pause', recalibration: 'recalibration' };
    const infoText = `#${row.sequence} · ${row.source === 'unknown' ? 'Auto' : row.source.toUpperCase()} · ${labels[row.state]}${row.translationMs === null ? '' : ` · request ${row.translationMs} ms`}`
      + (turn?.boundary ? ` · ${boundaries[turn.boundary]}${turn.audioMs === undefined ? '' : ` (${(turn.audioMs / 1000).toFixed(1)} s)`}` : '')
      + (turn?.quality?.droppedSegments ? ` · filtered ${turn.quality.droppedSegments} decoder pieces` : '')
      + (turn?.recognitionClipped ? ' · original character limit reached' : '');
    if (info.textContent !== infoText) info.textContent = infoText;
  }
  for (const [id, node] of existing) if (!keep.has(id!)) node.remove();
}
