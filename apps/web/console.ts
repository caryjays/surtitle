import { audienceView, DEFAULT_OVERLAY, OVERLAY_KEY, overlayQuery, overlaySettings, type OverlaySettings } from './audience.ts';
import type { Command, Snapshot } from '../../packages/protocol/index.ts';

type Send = (command: ReturnType<typeof Command.parse>) => void;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function storage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; /* Browser privacy settings may forbid storage. */ }
}

// Audience view preview plus the overlay settings that shape it and the Browser Source URL that carries them.
export function setupAudience() {
  const view = audienceView(element('audience').querySelector<HTMLElement>('.stage-captions')!, element('audience-roll'));
  const lines = element<HTMLSelectElement>('overlay-lines');
  const pace = element<HTMLInputElement>('overlay-pace');
  const url = element<HTMLInputElement>('overlay-url');
  let settings = DEFAULT_OVERLAY;
  try { settings = overlaySettings(JSON.parse(storage()?.getItem(OVERLAY_KEY) ?? 'null')); } catch { /* Malformed storage: defaults. */ }
  function apply(next: OverlaySettings) {
    settings = next; view.configure(settings);
    lines.value = String(settings.lines); pace.checked = settings.pace;
    url.value = `${location.origin}/overlay${overlayQuery(settings)}`;
    element<HTMLAnchorElement>('overlay-open').href = `/overlay${overlayQuery(settings)}`;
    // Persist ONLY the validated overlay settings.
    try { storage()?.setItem(OVERLAY_KEY, JSON.stringify(settings)); } catch { /* Storage may be disabled or full. */ }
  }
  const change = () => apply(overlaySettings({ lines: Number(lines.value), pace: pace.checked }));
  lines.addEventListener('change', change); pace.addEventListener('change', change);
  element('overlay-copy').addEventListener('click', () => {
    url.select();
    const done = (text: string) => { element('overlay-copied').textContent = text; };
    navigator.clipboard?.writeText(url.value).then(() => done('Copied.'), () => done('Selected; copy with ⌘C.')) ?? done('Selected; copy with ⌘C.');
  });
  // The stage is laid out at 1920 × 1080 and scaled to the panel, so the preview matches the Browser Source.
  const stage = element('audience').querySelector<HTMLElement>('.stage')!;
  new ResizeObserver(() => stage.style.setProperty('--stage-scale', String(element('audience').clientWidth / 1920))).observe(element('audience'));
  apply(settings);
  return (state: Snapshot | undefined, receivedAt: number) => view.render(state, receivedAt, Date.now());
}

// Direction, segmentation and translation for the session. Segmentation applies at the next Start.
export function setupSession(send: Send) {
  const fieldset = element<HTMLFieldSetElement>('segmentation');
  const radios = [...fieldset.querySelectorAll<HTMLInputElement>('input[name="segmentation"]')];
  const translation = element<HTMLInputElement>('translation-toggle');
  for (const radio of radios) radio.addEventListener('change', () => {
    if (radio.checked) send({ type: 'set-segmentation', segmentation: radio.value as 'turns' | 'rolling' });
  });
  translation.addEventListener('change', () => send({ type: 'set-translation', enabled: translation.checked }));
  return (state: Snapshot | undefined, connected: boolean) => {
    const capturing = ['active', 'connecting', 'stopping'].includes(state?.capture ?? '');
    fieldset.hidden = !state?.segmentation;
    for (const radio of radios) { radio.checked = radio.value === state?.segmentation; radio.disabled = !connected || capturing; }
    element('segmentation-note').textContent = capturing ? 'Pause to change; applies at the next Start.' : 'Applies at the next Start.';
    const available = Boolean(state?.translation.available);
    element('translation-setting').hidden = !available;
    translation.checked = Boolean(state?.translation.enabled); translation.disabled = !connected;
    element('translation-note').textContent = available
      ? state!.translation.enabled ? 'Each finalized row is sent for translation; turning this off drops queued requests.' : 'Off: original text only, no requests.'
      : 'Translation is available when the service starts with the listen profile.';
  };
}

function median(values: (number | undefined)[]) {
  const sorted = values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : undefined;
}
const seconds = (ms: number | undefined) => ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`;
// Content-free health from the snapshot: configuration, queues and recent row timings.
export function renderHealth(state: Snapshot | undefined, connected: boolean) {
  const list = element('health');
  const recent = state?.turns.slice(-10) ?? [];
  const rolling = state?.segmentation === 'rolling';
  const rows: [string, string][] = !state ? [['Service', connected ? 'waiting for status' : 'disconnected']] : [
    ['Service', connected ? 'connected' : 'disconnected'],
    ['Capture', state.capture],
    ['Recognition', `${state.backend.split(' · ')[0]}${state.segmentation ? ` · ${state.segmentation}` : ''}`],
    ['Translation', !state.translation.available ? 'not configured' : state.translation.enabled ? 'on' : 'off'],
    ['Queue', `${state.queue} waiting · ${state.running} translating`],
    ['Filtered rows', String(state.rejected)],
    ['Recognition per decode', seconds(median(recent.map(t => t.recognitionInferenceMs)))],
    ...(rolling ? [['First text', seconds(median(recent.map(t => t.firstTextMs)))], ['Lock lag', seconds(median(recent.map(t => t.lockLagMs)))]] as [string, string][]
      : [['Commit to final', seconds(median(recent.map(t => t.commitToFinalMs)))]] as [string, string][]),
    ['Translation request', seconds(median(recent.map(t => t.translationMs)))],
    ['Failed or skipped', String(recent.filter(t => ['failed', 'skipped', 'capture-failed'].includes(t.outcome)).length)],
  ];
  const text = rows.map(([k, v]) => `${k}\u0000${v}`).join('\n');
  if (list.dataset.text === text) return;
  list.dataset.text = text;
  list.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
}

// Single-key shortcuts, ignored while typing or with modifier keys. Destructive commands stay click-only.
export function setupShortcuts(actions: Record<string, () => void>) {
  const dialog = element<HTMLDialogElement>('shortcuts');
  const open = () => { if (!dialog.open) dialog.showModal(); };
  element('shortcuts-open').addEventListener('click', open);
  element('shortcuts-close').addEventListener('click', () => dialog.close());
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || event.isComposing) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, [contenteditable]') || (dialog.open && event.key !== '?')) return;
    const key = event.key === '?' ? '?' : event.key.toLowerCase();
    const action = key === '?' ? open : actions[key];
    if (!action) return;
    event.preventDefault(); action();
  });
}
