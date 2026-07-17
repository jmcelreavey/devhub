// Theme bridge between the DevHub app shell and the bespoke briefing canvas.
//
// The canvas renders inside a same-origin iframe with its own document, so it
// does NOT inherit the app's CSS variables. To stop a light canvas sitting on a
// dark app (or vice-versa), the client reads the app's resolved theme tokens off
// <html data-theme=...> and passes them to the canvas, which grounds its whole
// design in them. Pure/DOM-only here (no node imports) so both client and server
// can use it.
//
// Quarantine: canvas CSS must only consume --app-* vars injected from this
// bridge (see Hallmark stamp on globals.css). Hex values below exist solely as
// SSR / decode mirrors of named shell tokens — never invent colours at call sites.

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

/** Mirrors Graphite Neon dark (`--bg`, `--bg-surface`, …). */
export const FALLBACK_DARK_THEME: CanvasTheme = {
  mode: "dark",
  bg: "#111416",
  surface: "#1b2024",
  elevated: "#232a30",
  text: "#ebeff3",
  muted: "#a5b0ba",
  subtle: "#7d8892",
  border: "#37414b",
  accent: "#9ed84a",
  accentFg: "#121710",
};

/** Mirrors Graphite Neon light. */
const FALLBACK_LIGHT_THEME: CanvasTheme = {
  mode: "light",
  bg: "#f7f8f9",
  surface: "#f7f8f9",
  elevated: "#f1f4f7",
  text: "#1f2a33",
  muted: "#4f6171",
  subtle: "#637281",
  border: "#cfd8df",
  accent: "#5d9e10",
  accentFg: "#f7f8f9",
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
