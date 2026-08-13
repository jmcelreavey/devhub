export type CatchUpWindow = "watermark" | "recent";

/** `undefined` means use the saved watermark; `null` explicitly means recent history. */
export function catchUpSince<T>(window: CatchUpWindow, saved: T | null): T | null {
  return window === "recent" ? null : saved;
}

/** A magnitude watermark stays caught up until the underlying fact grows. */
export function isCaughtUp(current: number, watermark: number): boolean {
  return current <= watermark;
}
