// The bespoke "canvas": a full, AI-authored HTML/CSS/JS document that IS the
// briefing page. The AI has complete control of the UX — layout, styling,
// animations, whatever — and the user reshapes it by chatting. The document is
// persisted verbatim; the daily data refresh just re-injects fresh data, so the
// design sticks until you ask to change it.
//
// Trust model: the user opted into running the canvas SAME-ORIGIN with full
// access (it can call /api/briefing/* directly). That's fine for a local,
// single-user dashboard. Data is injected as window.__BRIEFING__ before the
// author's script runs, JSON-escaped so it can't break out of the script tag.

import path from "node:path";
import { generateText } from "ai";
import { getNotesAiModel, getNotesAiCallOptions } from "@/lib/ai-provider";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { getRepoRoot } from "@/lib/notes-dir";
import { writeAtomic, safeReadJSON, withMutex } from "@/lib/atomic-write";
import { BRIEFING_DATA_SHAPE, type BriefingContext } from "@/lib/briefing-context";
import { DEFAULT_CANVAS_HTML } from "@/lib/briefing-canvas-default";
import { isImageAiConfigured } from "@/lib/briefing-images";
import { tasteDirectivesForPrompt } from "@/lib/briefing-taste";
import type { CanvasTheme } from "@/lib/briefing-theme";

export interface CanvasDoc {
  html: string;
  revision: number;
  updatedAt: string;
  /** The most recent design instruction that produced this canvas. */
  lastInstruction: string | null;
  /** True once the AI (rather than the built-in default) has authored it. */
  aiAuthored: boolean;
}

const CANVAS_VERSION = 1;

interface StoredCanvas {
  version: number;
  doc: CanvasDoc;
}

function canvasFile(): string {
  return path.join(getRepoRoot(), "notes", ".config", "briefing-canvas.json");
}

const DEFAULT_DOC: CanvasDoc = {
  html: DEFAULT_CANVAS_HTML,
  revision: 0,
  updatedAt: "1970-01-01T00:00:00.000Z",
  lastInstruction: null,
  aiAuthored: false,
};

export function readCanvas(): CanvasDoc {
  const stored = safeReadJSON<StoredCanvas | null>(canvasFile(), null);
  if (!stored || stored.version !== CANVAS_VERSION || !stored.doc?.html) return DEFAULT_DOC;
  return stored.doc;
}

export async function saveCanvas(html: string, instruction: string | null): Promise<CanvasDoc> {
  const prev = readCanvas();
  const doc: CanvasDoc = {
    html,
    revision: prev.revision + 1,
    updatedAt: new Date().toISOString(),
    lastInstruction: instruction,
    aiAuthored: true,
  };
  const file = canvasFile();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ version: CANVAS_VERSION, doc } satisfies StoredCanvas, null, 2));
  });
  return doc;
}

export async function resetCanvas(): Promise<CanvasDoc> {
  const file = canvasFile();
  await withMutex(file, async () => {
    await writeAtomic(file, JSON.stringify({ version: CANVAS_VERSION, doc: DEFAULT_DOC } satisfies StoredCanvas, null, 2));
  });
  return DEFAULT_DOC;
}

// ── Rendering ────────────────────────────────────────────────────────────────

// U+2028 / U+2029 are valid in JSON but are line terminators in JS, so they must
// be escaped before being embedded in an inline <script>. Built from char codes
// to keep this source pure-ASCII.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

function escapeForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

function themeStyleTag(theme: CanvasTheme): string {
  // Expose the app's resolved tokens as CSS variables + color-scheme so the
  // canvas can ground its whole design in the host theme (dark canvas on a dark
  // app, light on light). Defined after the author's <style> so the vars are
  // available; canvases reference them (or window.__BRIEFING__.theme).
  return (
    "<style>:root{color-scheme:" + theme.mode +
    ";--app-bg:" + theme.bg +
    ";--app-surface:" + theme.surface +
    ";--app-elevated:" + theme.elevated +
    ";--app-text:" + theme.text +
    ";--app-muted:" + theme.muted +
    ";--app-subtle:" + theme.subtle +
    ";--app-border:" + theme.border +
    ";--app-accent:" + theme.accent +
    ";--app-accent-fg:" + theme.accentFg + "}</style>"
  );
}

/** Inject the live data (+ host theme) and a refresh helper, then return a full HTML document. */
export function renderCanvasDocument(html: string, context: BriefingContext, theme?: CanvasTheme | null): string {
  const payload = escapeForScript(JSON.stringify(context));
  const themeJson = theme ? escapeForScript(JSON.stringify(theme)) : "null";
  const boot =
    "<script>window.__BRIEFING__=" + payload + ";window.__BRIEFING__.theme=" + themeJson +
    ";window.__BRIEFING_REFRESH__=function(){var t=window.__BRIEFING__&&window.__BRIEFING__.theme;" +
    "return fetch('/api/briefing/data?refresh=1',{cache:'no-store'})" +
    ".then(function(r){return r.json();}).then(function(j){window.__BRIEFING__=(j&&j.context)||j;window.__BRIEFING__.theme=t;return window.__BRIEFING__;});};</script>" +
    (theme ? themeStyleTag(theme) : "");

  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, boot + "</head>");
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => m + boot);
  return boot + html;
}

// ── AI generation ────────────────────────────────────────────────────────────

const MAX_CANVAS_CHARS = 90_000;

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function looksLikeDocument(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    html.length > 200 &&
    lower.includes("<") &&
    (lower.includes("<html") ||
      lower.includes("<body") ||
      lower.includes("<!doctype") ||
      lower.includes("<div") ||
      lower.includes("<section"))
  );
}

/**
 * Author (or revise) the canvas from a natural-language instruction. Returns a
 * full HTML document string, or null if AI is unavailable / the output was junk
 * (callers keep the current canvas in that case).
 */
export async function generateCanvasHtml(
  instruction: string,
  dataForPrompt: Record<string, unknown>,
  currentHtml: string | null,
  theme?: CanvasTheme | null,
): Promise<string | null> {
  if (!isNotesAiConfigured()) return null;
  const model = getNotesAiModel();
  if (!model) return null;

  const revising = Boolean(currentHtml && currentHtml.length > 200);
  const themeLine = theme
    ? `HOST THEME (the app's tokens — the DEFAULT palette; see STYLE PRECEDENCE): the injected window.__BRIEFING__.theme and these CSS variables are available: --app-bg ${theme.bg}, --app-surface ${theme.surface}, --app-elevated ${theme.elevated}, --app-text ${theme.text}, --app-muted ${theme.muted}, --app-subtle ${theme.subtle}, --app-border ${theme.border}, --app-accent ${theme.accent}, --app-accent-fg ${theme.accentFg}. By default use theme.bg as the page background, theme.text as the primary text, theme.accent as the single accent, and theme.border/surface for structure. The canvas sits inside a ${theme.mode}-mode app, so keep a ${theme.mode} page unless the user explicitly asks otherwise.`
    : "";
  const precedence = [
    "STYLE PRECEDENCE (read carefully):",
    "- The taste rules and host theme above are the DEFAULT style, not a cage.",
    "- When the user's request names a specific aesthetic (colourful, anime, neon, retro terminal, pastel, cyberpunk, playful, brutalist...), THEIR AESTHETIC WINS over theme-matching and the colour-quarantine/single-accent rules: commit to it fully with a custom palette, multiple accents, gradients, or expressive backgrounds as the look demands. A half-hearted default-theme page with the requested style ignored is a failure.",
    "- An aesthetic overhaul is licence to redesign the LAYOUT too — new structure, new card shapes, new hero. Do not preserve the previous document's skeleton with recoloured chrome and call it done.",
    "- Layout quality, readability, accessibility, motion restraint, content honesty, and punctuation rules ALWAYS apply regardless of aesthetic.",
    "- When the user has not asked for a look, follow the host theme and taste rules exactly.",
  ].join("\n");
  const imagery = isImageAiConfigured()
    ? [
        "GENERATED IMAGERY (available on this machine):",
        "- GET /api/briefing/image?prompt=<url-encoded description>&size=1536x1024 returns an AI-generated PNG (sizes: 1024x1024, 1536x1024, 1024x1536). Same-origin, cached per prompt — safe to reference from <img> or CSS url().",
        "- Use it when the user asks for generated/illustrated imagery or when their chosen aesthetic begs for art (an anime look wants an illustrated backdrop, not just gradients).",
        "- Write rich, specific prompts: style, palette, subject, mood, and ALWAYS append 'no text, no words, no captions'. Example: a full-bleed hero background plus one small themed illustration per major card.",
        "- Keep it to at most 4 distinct image prompts per page. Reuse one prompt for repeated decorations.",
        "- Text must stay readable: put a contrast overlay (scrim/gradient) between any background image and text.",
        "- Generation takes a few seconds on first load: give <img> loading=\"lazy\", a CSS background-color placeholder, meaningful alt text, and an error listener (addEventListener('error', ...)) that hides the element so a failed/unconfigured image never leaves a broken icon.",
      ].join("\n")
    : "";

  try {
    const result = await generateText({
      model,
      maxOutputTokens: 16_000,
      ...getNotesAiCallOptions(),
      prompt: [
        "You are the sole designer and front-end engineer for a personal daily-briefing screen.",
        "You have real creative control of layout, colour, typography and motion, but you must ship tasteful, professional work that obeys the house rules below. Tasteful and restrained beats busy and decorative.",
        "",
        tasteDirectivesForPrompt(),
        "",
        themeLine,
        "",
        precedence,
        "",
        imagery,
        "",
        "TECHNICAL CONTRACT:",
        "- Output a SINGLE, COMPLETE, self-contained HTML document (start with <!doctype html>). Inline all CSS in one <style> and all JS in one <script>. No external stylesheets or fonts unless from a well-known CDN.",
        "- The document runs same-origin in an iframe. The data is ALREADY injected before your script as window.__BRIEFING__ (shape below). Read from it; never hardcode data. You may also call fetch('/api/briefing/data') at runtime.",
        "- Build DOM with document.createElement / textContent (never innerHTML) so feed text cannot inject markup. Open links in a new tab.",
        "- Render only real values from the data. Omit any section with no data. Never print null, undefined, NaN, or a section that is all zeros.",
        "- Return ONLY the HTML document. No markdown, no code fences, no commentary.",
        "",
        "DATA CONTRACT:",
        BRIEFING_DATA_SHAPE,
        "",
        "Current data snapshot (reference only; the live object is injected at runtime):",
        JSON.stringify(dataForPrompt).slice(0, 12_000),
        "",
        revising
          ? "You are REVISING the existing design below. Apply the user's request, keep what they did not ask to change, and fix any house-rule violations you notice (especially cramped narrow columns and wasted width):"
          : "There is no prior design; create one from scratch.",
        revising ? "----- CURRENT DOCUMENT -----" : "",
        revising ? (currentHtml as string).slice(0, 40_000) : "",
        revising ? "----- END CURRENT DOCUMENT -----" : "",
        "",
        "User request: " + instruction,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (!result.text || result.finishReason === "length") return null;
    const html = stripFences(result.text).slice(0, MAX_CANVAS_CHARS);
    return looksLikeDocument(html) ? html : null;
  } catch {
    return null;
  }
}
