import { z } from 'zod';
import { renderSegments, shownRow } from './client.ts';
import { DEFAULT_PACE, Pacer } from './pacer.ts';
import { visibleSegments } from './visibility.ts';
import type { Snapshot } from '../../packages/protocol/index.ts';

// Overlay settings travel in the Browser Source URL; the operator page keeps its copy in browser storage.
const OverlaySettings = z.object({ lines: z.number().int().min(1).max(8), pace: z.boolean() }).strict();
export type OverlaySettings = z.infer<typeof OverlaySettings>;
export const DEFAULT_OVERLAY: OverlaySettings = { lines: 4, pace: true };
export const OVERLAY_KEY = 'captions.overlay.v1';
export function overlaySettings(value: unknown): OverlaySettings {
  const parsed = OverlaySettings.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_OVERLAY };
}
export function overlayQuery(settings: OverlaySettings) {
  const parts = [...(settings.lines === DEFAULT_OVERLAY.lines ? [] : [`lines=${settings.lines}`]), ...(settings.pace ? [] : ['pace=off'])];
  return parts.length ? `?${parts.join('&')}` : '';
}
export function parseOverlayQuery(search: string): OverlaySettings {
  const params = new URLSearchParams(search);
  const lines = Number(params.get('lines') ?? DEFAULT_OVERLAY.lines);
  return overlaySettings({ lines: Number.isInteger(lines) ? lines : DEFAULT_OVERLAY.lines, pace: params.get('pace') !== 'off' });
}

// The audience view: released text of the latest rows in a roll-up window. Text that grows the window slides earlier
// lines up instead of jumping; the window clips the oldest. Used by the overlay and the operator page's preview.
export function audienceView(window: HTMLElement, roll: HTMLElement) {
  const pacer = new Pacer();
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let height = 0;
  return {
    configure(settings: OverlaySettings) {
      pacer.configure({ ...DEFAULT_PACE, enabled: settings.pace });
      window.style.setProperty('--overlay-lines', String(settings.lines));
    },
    render(state: Snapshot | undefined, receivedAt: number, now: number) {
      const paced = pacer.update(state, now);
      const rows = paced.filter(row => shownRow(row, false));
      renderSegments(roll, visibleSegments(state, receivedAt, now, rows, 6), false, [], state?.pair);
      const grown = roll.offsetHeight - height;
      height = roll.offsetHeight;
      if (grown > 0 && !still.matches) {
        roll.style.transition = 'none'; roll.style.transform = `translateY(${grown}px)`;
        roll.getBoundingClientRect();
        roll.style.transition = 'transform 250ms ease-out'; roll.style.transform = '';
      }
      // Every row as this view's pacer has released it, for diagnostics.
      return paced;
    },
  };
}
