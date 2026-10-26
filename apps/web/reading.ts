import { z } from 'zod';

const Preferences = z.object({
  translationSize: z.number().int().min(18).max(48).multipleOf(2),
  originalSize: z.number().int().min(12).max(32).multipleOf(2),
  spacing: z.enum(['compact', 'comfortable', 'roomy']),
  width: z.enum(['narrow', 'wide', 'full']).default('wide'),
  details: z.boolean(),
}).strict();
export type ReadingPreferences = z.infer<typeof Preferences>;
export const DEFAULT_READING: ReadingPreferences = {
  translationSize: 28, originalSize: 18, spacing: 'comfortable', width: 'wide', details: false,
};
export const READING_KEY = 'captions.reading.v1';

export function readingPreferences(value: unknown): ReadingPreferences {
  const parsed = Preferences.safeParse(value);
  const result = parsed.success ? parsed.data : { ...DEFAULT_READING };
  return { ...result, originalSize: Math.min(result.originalSize, result.translationSize - 4) };
}
export function loadReading(storage?: Pick<Storage, 'getItem'>): ReadingPreferences {
  try { return readingPreferences(JSON.parse(storage?.getItem(READING_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_READING }; }
}
export function saveReading(value: ReadingPreferences, storage?: Pick<Storage, 'setItem'>) {
  // Persist ONLY validated display settings, never arbitrary objects or caption data.
  try { storage?.setItem(READING_KEY, JSON.stringify(readingPreferences(value))); } catch { /* Storage may be disabled. */ }
}

export function setupReadingControls(preservePosition: (update: () => void) => void) {
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Browser privacy settings may forbid storage. */ }
  let preferences = loadReading(storage);
  const original = document.getElementById('original-size') as HTMLInputElement;
  const translation = document.getElementById('translation-size') as HTMLInputElement;
  const spacing = document.getElementById('reading-spacing') as HTMLSelectElement;
  const details = document.getElementById('caption-details') as HTMLInputElement;
  const width = document.getElementById('reading-width') as HTMLSelectElement;
  const focus = document.getElementById('reading-focus') as HTMLButtonElement;
  const panel = document.getElementById('reading-settings') as HTMLDetailsElement;
  function apply() {
    document.body.style.setProperty('--original-size', `${preferences.originalSize}px`);
    document.body.style.setProperty('--translation-size', `${preferences.translationSize}px`);
    document.body.dataset.spacing = preferences.spacing;
    document.body.dataset.readingWidth = preferences.width;
    document.body.dataset.captionDetails = String(preferences.details);
    original.max = String(Math.min(32, preferences.translationSize - 4));
    original.value = String(preferences.originalSize); translation.value = String(preferences.translationSize);
    spacing.value = preferences.spacing; details.checked = preferences.details; width.value = preferences.width;
    document.getElementById('original-size-value')!.textContent = `${preferences.originalSize} px`;
    document.getElementById('translation-size-value')!.textContent = `${preferences.translationSize} px`;
  }
  function change() {
    preferences = readingPreferences({ originalSize: Number(original.value), translationSize: Number(translation.value),
      spacing: spacing.value, details: details.checked, width: width.value });
    preservePosition(apply); saveReading(preferences, storage);
  }
  original.addEventListener('input', change); translation.addEventListener('input', change);
  spacing.addEventListener('change', change); details.addEventListener('change', change); width.addEventListener('change', change);
  document.getElementById('reading-reset')!.addEventListener('click', () => {
    preferences = { ...DEFAULT_READING }; preservePosition(apply); saveReading(preferences, storage);
  });
  focus.addEventListener('click', () => preservePosition(() => {
    const focused = document.body.dataset.readingFocus !== 'true';
    document.body.dataset.readingFocus = String(focused);
    focus.setAttribute('aria-pressed', String(focused));
    focus.textContent = focused ? 'Exit reading focus' : 'Reading focus';
    if (focused) { panel.open = false; (document.getElementById('diagnostics') as HTMLDetailsElement).open = false; }
  }));
  // Opening either settings panel changes available reading height, too.
  panel.addEventListener('toggle', () => preservePosition(() => {}));
  document.getElementById('diagnostics')!.addEventListener('toggle', () => preservePosition(() => {}));
  apply();
}
