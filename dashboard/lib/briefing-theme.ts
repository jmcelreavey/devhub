// Theme bridge between the DevHub app shell and the bespoke briefing canvas.
//
// The canvas renders inside a same-origin iframe with its own document, so it
// does NOT inherit the app's CSS variables. To stop a light canvas sitting on a
// dark app (or vice-versa), the client reads the app's resolved theme tokens off
// <html data-theme=...> and passes them to the canvas, which grounds its whole
// design in them. Pure/DOM-only here (no node imports) so both client and server
// can use it.

export interface CanvasTheme {
  mode: "dark" | "light";
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  subtle: string;
  border: string;
  accent: string;
  accentFg: string;
}

export const FALLBACK_DARK_THEME: CanvasTheme = {
  mode: "dark",
  bg: "#0f1216",
  surface: "#161a1f",
  elevated: "#1c2127",
  text: "#e7ecf3",
  muted: "#9aa7b8",
  subtle: "#66748a",
  border: "#262b33",
  accent: "#4f8cff",
  accentFg: "#ffffff",
};

const FALLBACK_LIGHT_THEME: CanvasTheme = {
  mode: "light",
  bg: "#f7f8f9",
  surface: "#ffffff",
  elevated: "#ffffff",
  text: "#1a1d21",
  muted: "#5a6472",
  subtle: "#8a94a3",
  border: "#e3e6ea",
  accent: "#2f6bff",
  accentFg: "#ffffff",
};

/** Colour values only ever come from computed CSS; keep them to a safe charset. */
function sanitizeColor(value: string, fallback: string): string {
  const clean = value.trim().replace(/[^#0-9a-zA-Z(),.%\s/-]/g, "").slice(0, 64);
  return clean || fallback;
}

/** Read the app's current resolved theme from the document (client only). */
export function readAppTheme(): CanvasTheme {
  if (typeof document === "undefined") return FALLBACK_DARK_THEME;
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const mode: "dark" | "light" = root.getAttribute("data-theme") === "light" ? "light" : "dark";
  const base = mode === "light" ? FALLBACK_LIGHT_THEME : FALLBACK_DARK_THEME;
  const g = (name: string, fallback: string) => sanitizeColor(cs.getPropertyValue(name), fallback);
  return {
    mode,
    bg: g("--bg", base.bg),
    surface: g("--bg-surface", base.surface),
    elevated: g("--bg-elevated", base.elevated),
    text: g("--text", base.text),
    muted: g("--text-muted", base.muted),
    subtle: g("--text-subtle", base.subtle),
    border: g("--border", base.border),
    accent: g("--accent", base.accent),
    accentFg: g("--accent-fg", base.accentFg),
  };
}

export function encodeTheme(theme: CanvasTheme): string {
  return encodeURIComponent(JSON.stringify(theme));
}

/** Parse + sanitize a theme passed via query param or request body (server side). */
export function decodeTheme(raw: string | null | undefined): CanvasTheme | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" && raw.startsWith("%") ? decodeURIComponent(raw) : raw);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return normalizeTheme(parsed);
}

export function normalizeTheme(raw: unknown): CanvasTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode: "dark" | "light" = o.mode === "light" ? "light" : "dark";
  const base = mode === "light" ? FALLBACK_LIGHT_THEME : FALLBACK_DARK_THEME;
  const g = (key: keyof CanvasTheme, fallback: string) =>
    typeof o[key] === "string" ? sanitizeColor(o[key] as string, fallback) : fallback;
  return {
    mode,
    bg: g("bg", base.bg),
    surface: g("surface", base.surface),
    elevated: g("elevated", base.elevated),
    text: g("text", base.text),
    muted: g("muted", base.muted),
    subtle: g("subtle", base.subtle),
    border: g("border", base.border),
    accent: g("accent", base.accent),
    accentFg: g("accentFg", base.accentFg),
  };
}
