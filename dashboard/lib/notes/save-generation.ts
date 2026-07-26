/** Increment when the active note changes or is deleted. */
export function nextNoteSaveGeneration(current: number): number {
  return current + 1;
}

/** True when a debounced save should still apply to the current note. */
export function isCurrentNoteSaveGeneration(scheduled: number, current: number): boolean {
  return scheduled === current;
}
