/**
 * Encodes a pinned seasonal / full-color logo choice in localStorage.
 * Plain Lucide labels (e.g. "Terminal") stay as-is; colorful picks use a prefix payload.
 */

import { isSeasonalMarkId } from "@/lib/seasonal-mark-ids";

export const PINNED_GLYPH_PREFIX = "__dh_glyph_v1__:";

export interface PinnedGlyphPayload {
  v: 1;
  /** Lucide option label from IconPicker (e.g. "Tree", "PartyPopper"). */
  icon: string;
  label: string;
  emoji: string;
  markId?: string;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function isPinnedGlyphStored(stored: string): boolean {
  return stored.startsWith(PINNED_GLYPH_PREFIX);
}

export function encodePinnedGlyph(payload: Omit<PinnedGlyphPayload, "v">): string {
  const full: PinnedGlyphPayload = { v: 1, ...payload };
  return PINNED_GLYPH_PREFIX + utf8ToBase64(JSON.stringify(full));
}

export function decodePinnedGlyph(stored: string): PinnedGlyphPayload | null {
  if (!isPinnedGlyphStored(stored)) return null;
  try {
    const raw = stored.slice(PINNED_GLYPH_PREFIX.length);
    const parsed: unknown = JSON.parse(base64ToUtf8(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (typeof o.icon !== "string" || typeof o.label !== "string") return null;
    const emoji = typeof o.emoji === "string" ? o.emoji : "";
    const markId = typeof o.markId === "string" ? o.markId : undefined;
    return { v: 1, icon: o.icon, label: o.label, emoji, markId };
  } catch {
    return null;
  }
}

/** True when this stored value should render as a full-color glyph (not the accent brand chip). */
export function isFullColorGlyphStored(stored: string): boolean {
  const g = decodePinnedGlyph(stored);
  if (!g) return false;
  return Boolean(g.emoji || (g.markId && isSeasonalMarkId(g.markId)));
}

export function pinnedGlyphMatchesEntry(
  stored: string,
  entry: { icon: string; label: string; emoji?: string; markId?: string },
): boolean {
  const g = decodePinnedGlyph(stored);
  if (!g) return false;
  const eEmoji = entry.emoji ?? "";
  const eMark = entry.markId ?? "";
  const gMark = g.markId ?? "";
  return g.icon === entry.icon && g.label === entry.label && g.emoji === eEmoji && gMark === eMark;
}
