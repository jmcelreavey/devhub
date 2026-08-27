import { useLongPress, type LongPressBind } from "@/lib/long-press";

export type PaletteRowPressBind = LongPressBind;

/**
 * Touch long-press opens a palette row in a new workspace tab; tap opens
 * normally. Mouse keeps click + Shift-click — long-press is touch/pen only.
 */
export function usePaletteRowPress(onTap: () => void, onLongPress: () => void): PaletteRowPressBind {
  return useLongPress({ onTap, onLongPress: () => onLongPress() });
}
