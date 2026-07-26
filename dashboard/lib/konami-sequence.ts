/**
 * The sequence, on its own, so the detector doesn't have to import the game.
 *
 * `components/KonamiGate.tsx` listens with this module (a few hundred bytes)
 * and only `import()`s the 2,000-line game once someone actually enters it.
 */
export const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
] as const;

/** Sequence resets if the next key doesn't arrive within this window. */
export const KONAMI_TIMEOUT_MS = 2_000;

/** True when the key event came from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Feed a key event to the matcher. Returns the next index, or `null` when the
 * full sequence has just completed.
 *
 * Kept pure so it can be unit-tested without a DOM.
 */
export function advanceKonami(index: number, key: string): number | null {
  const normalised = key.length === 1 ? key.toLowerCase() : key;
  const expected = KONAMI_SEQUENCE[index];
  if (normalised === expected || normalised.toLowerCase() === expected) {
    const next = index + 1;
    return next === KONAMI_SEQUENCE.length ? null : next;
  }
  // A miss restarts the run — but the key might itself be a valid first key.
  return normalised === KONAMI_SEQUENCE[0] || normalised.toLowerCase() === KONAMI_SEQUENCE[0]
    ? 1
    : 0;
}
