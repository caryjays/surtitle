import { z } from 'zod';
import { renderSegments, shownRow } from './client.ts';
import { DEFAULT_PACE, Pacer, type ShownRow } from './pacer.ts';
import { visibleSegments } from './visibility.ts';
import type { Snapshot } from '../../packages/protocol/index.ts';

// Overlay settings travel in the Browser Source URL; the operator page keeps its copy in browser storage.
const OverlaySettings = z.object({ lines: z.number().int().min(1).max(8), pace: z.boolean(), early: z.boolean().default(true) }).strict();
export type OverlaySettings = z.infer<typeof OverlaySettings>;
export const DEFAULT_OVERLAY: OverlaySettings = { lines: 4, pace: true, early: true };
export const OVERLAY_KEY = 'captions.overlay.v1';
export function overlaySettings(value: unknown): OverlaySettings {
  const parsed = OverlaySettings.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_OVERLAY };
}
export function overlayQuery(settings: OverlaySettings) {
  const parts = [...(settings.lines === DEFAULT_OVERLAY.lines ? [] : [`lines=${settings.lines}`]), ...(settings.pace ? [] : ['pace=off']), ...(settings.early ? [] : ['early=off'])];
  return parts.length ? `?${parts.join('&')}` : '';
}
export function parseOverlayQuery(search: string): OverlaySettings {
  const params = new URLSearchParams(search);
  const lines = Number(params.get('lines') ?? DEFAULT_OVERLAY.lines);
  return overlaySettings({ lines: Number.isInteger(lines) ? lines : DEFAULT_OVERLAY.lines, pace: params.get('pace') !== 'off', early: params.get('early') !== 'off' });
}

// The row the audience is reading: the earliest shown row whose translation has not all been released, or has not come yet.
export function readingRow<T extends ShownRow>(rows: T[]) {
  return rows.find(row => row.translationRest || row.state === 'pending');
}
// How far the roll moves down from its bottom anchor so that text of `height` ending `below` its bottom stays in a window
// of `windowHeight`: all of it if it fits, otherwise its end.
export function rollShift(below: number, height: number, windowHeight: number) {
  return Math.max(0, below + Math.min(height, windowHeight) - windowHeight);
}

// The audience view: released text of the latest rows in a roll-up window. Text that grows the window slides earlier
// lines up instead of jumping; the window clips the oldest. The window follows the translation being read: later rows
// that would push it out wait below the window, hidden, until it has been released. Used by the overlay and the operator
// page's preview.
export function audienceView(window: HTMLElement, roll: HTMLElement) {
  const pacer = new Pacer();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let height = 0;
  let shift = 0;
  return {
    configure(settings: OverlaySettings) {
      pacer.configure({ ...DEFAULT_PACE, enabled: settings.pace, early: settings.early });
      window.style.setProperty('--overlay-lines', String(settings.lines));
    },
    render(state: Snapshot | undefined, receivedAt: number, now: number) {
      const paced = pacer.update(state, now);
      const rows = visibleSegments(state, receivedAt, now, paced.filter(row => shownRow(row, false)), 6);
      renderSegments(roll, rows, false, [], state?.pair);
      const articles = [...roll.children] as HTMLElement[];
      const bottom = (element: HTMLElement) => roll.offsetHeight - element.offsetTop - element.offsetHeight;
      const reading = readingRow(rows);
      const article = reading && articles.find(node => node.dataset.id === reading.id);
      const text = article && (article.querySelector<HTMLElement>('.translation') ?? article.querySelector<HTMLElement>('.original')!);
      const next = text ? rollShift(bottom(text), text.offsetHeight, window.clientHeight) : 0;
      // A row that would show only in part below the window waits unseen.
      for (const node of articles) {
        const waiting = bottom(node) < next - 0.5;
        if (waiting !== (node.dataset.waiting === 'true')) { if (waiting) node.dataset.waiting = 'true'; else delete node.dataset.waiting; }
      }
      const from = shift + Math.max(0, roll.offsetHeight - height);
      height = roll.offsetHeight; shift = next;
      const place = (pixels: number) => { roll.style.transform = pixels ? `translateY(${pixels}px)` : ''; };
      if (from !== next && !still.matches) {
        roll.style.transition = 'none'; place(from);
        roll.getBoundingClientRect();
        roll.style.transition = 'transform 250ms ease-out'; place(next);
      } else if (from !== next) { roll.style.transition = 'none'; place(next); }
      // Every row as this view's pacer has released it, for diagnostics.
      return paced;
    },
  };
}
