// Taste guidance for the AI-authored briefing canvas.
//
// The team keeps an "anti-slop" frontend skill at skills/shared/taste-skill. That
// skill is written for Tailwind/React landing pages and is far too large (and too
// landing-page-specific) to feed verbatim into every generation, so this module
// distills its universal, framework-agnostic rules into a compact directive block
// tuned for a vanilla-HTML information dashboard. Keep this in sync with the skill.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "@/lib/notes-dir";

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Resolve the taste-skill SKILL.md if it's installed anywhere we know about. */
export function resolveTasteSkill(): string | null {
  const candidates = [
    path.join(getRepoRoot(), "skills", "shared", "taste-skill", "SKILL.md"),
    "~/.claude/skills/taste-skill/SKILL.md",
    "~/.config/opencode/skills/taste-skill/SKILL.md",
    "~/.opencode/skills/taste-skill/SKILL.md",
  ].map(expandHome);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function tasteSkillAvailable(): boolean {
  return resolveTasteSkill() !== null;
}

// Distilled from skills/shared/taste-skill (sections 4, 6, 8, 9). Framework-
// agnostic, tuned for a personal daily-briefing dashboard rendered as a single
// vanilla HTML document.
//
// Composition: the palette rules come in two mutually exclusive flavours.
// HOUSE_PALETTE_RULES lock the canvas to the app theme (the default).
// CUSTOM_PALETTE_RULES apply when the user has explicitly chosen an aesthetic
// (anime, neon, retro…) — the user owns the palette, and the house colour
// quarantine must NOT be in the prompt at all (a rule that is present but
// "overridden" still drags generations back to the theme).
const FRAME_RULES = [
  "TASTE RULES (house anti-slop standard — follow all of them):",
  "",
  "Frame: this is a personal daily-briefing DASHBOARD, not a marketing landing page. It should feel dense-but-scannable and genuinely useful. No marketing hero, no scroll-tricks, no fake product UI, no filler copy.",
].join("\n");

const HOUSE_PALETTE_RULES = [
  "Theme (match the host app):",
  "- The canvas is embedded in the DevHub app. Read window.__BRIEFING__.theme = { mode: 'dark'|'light', bg, surface, elevated, text, muted, subtle, border, accent, accentFg } and ground the WHOLE design in it. The matching CSS variables (--app-bg, --app-text, --app-accent, etc.) are also injected.",
  "- Page background = theme.bg / var(--app-bg), primary text = theme.text / var(--app-text), single accent = theme.accent / var(--app-accent), structure = theme.border/surface. If mode is dark, ship a dark design; if light, ship a light one. Never mismatch the host.",
  "- QUARANTINE: every colour in the canvas MUST be a --app-* token or a value from window.__BRIEFING__.theme. No freestyle hex, rgba stacks, or purple/blue glow blobs.",
  "",
  "Colour:",
  "- Exactly ONE accent colour, locked across the whole page. Neutral base (zinc/slate/stone, or a single warm neutral). Accent saturation under ~80%.",
  "- No AI-purple/blue glow, no neon, no rainbow or multi-stop gradients, no oversaturated accents. A restrained single-hue gradient is fine.",
  "- Off-black and off-white only. Never pure #000 or #fff. Tint shadows to the background hue; never pure-black drop shadows.",
].join("\n");

const CUSTOM_PALETTE_RULES = [
  "Colour & theme (USER-DIRECTED AESTHETIC — the user chose this look; you own the palette):",
  "- Ignore the app's theme tokens for colour. Build a bespoke palette that delivers the requested aesthetic at full commitment: saturated colour, multiple accents, gradients, glow, illustrated backgrounds — whatever the look demands. A page that could pass as the app's default theme is a FAILURE.",
  "- The new identity must be unmistakable at a glance: background, cards, headings, and chips should all carry the aesthetic, not just a tinted border.",
  "- Non-negotiables that survive any aesthetic: text meets WCAG AA contrast (put scrims/overlays between artwork and text), shadows are tinted (never pure black), and the page stays cohesive — bold is great, incoherent is not.",
].join("\n");

const UNIVERSAL_RULES = [
  "Type:",
  "- ONE sans family (a clean grotesk; a good system stack is fine). Optionally ONE mono, used only for numbers/times. Do not mix a random serif into a sans headline.",
  "- Control hierarchy with weight, size and colour, not one giant scream headline. Body measure ~60-75 characters.",
  "",
  "Layout (this is where AI output usually breaks — get it right):",
  "- Use the FULL width of the container. Do not leave a huge empty right-hand column while content crams into the left.",
  "- Columns must be wide enough that item titles read as normal wrapped sentences. NEVER so narrow that text wraps one word per line. For card/tile grids use a minimum column width around 260-320px (e.g. grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))).",
  "- Match column count to how many items you actually have. 3 items is not a 6-column grid stretched thin. If a section has few items, use fewer, wider columns.",
  "- Long lists of headlines/links (news, Hacker News, events) are NOT skinny vertical cards. Render them as readable rows or a 2-3 column list where each title sits comfortably on 1-2 lines. Prefer compact rows separated by hairlines over boxed cards when there is no real hierarchy.",
  "- One corner-radius scale and one shadow style for the whole page. Cards only when elevation communicates real hierarchy; otherwise group with spacing and hairlines.",
  "- Deliberate, consistent spacing on a scale. No floating elements with awkward gaps. No section header with a tiny paragraph or label floating alone in the top-right corner — put labels under/next to the heading with real alignment, or drop them.",
  "- Fully responsive: every multi-column block collapses cleanly to one column under ~600px.",
  "",
  "Motion & a11y:",
  "- Motion is minimal and motivated (it should communicate hierarchy, state or feedback). Animate only transform and opacity.",
  "- Honour prefers-reduced-motion: collapse all animation to static/instant. Keep one page theme; sections never invert light/dark. Every link and control meets WCAG AA contrast; links open in a new tab; include hover/active states.",
  "",
  "Content honesty (only render the real injected data):",
  "- Never invent facts, names, numbers, logos or placeholder content. No 'Jane Doe', no 'Acme', no fake stats. If a data field is empty, omit that whole section.",
  "- Format values for humans: turn ISO timestamps (sunrise/sunset/meta) into short local times like 05:04, never show a raw 2026-07-09T05:04 string. Do not print the same metadata twice in one row (e.g. source shown on both sides).",
  "- No filler marketing verbs (elevate, seamless, unleash, next-gen). No section-number eyebrows (01 / INDEX), no scroll cues, no decorative status dots on every row, no fake screenshots or version stamps.",
  "",
  "Punctuation (non-negotiable):",
  "- ZERO em-dashes (—) and zero en-dashes (–) anywhere the user can see them: headlines, labels, body, captions, buttons. Use a normal hyphen (-) or restructure the sentence. Ration the middle-dot (·) to at most one per metadata line.",
].join("\n");

/**
 * The block to inject into the canvas-generation prompt. With
 * `customAesthetic` the house theme/colour lockdown is REPLACED by
 * user-owns-the-palette rules — conflicting rules must not co-exist in the
 * prompt, or generations drift back to the app theme.
 */
export function tasteDirectivesForPrompt(opts?: { customAesthetic?: boolean }): string {
  const palette = opts?.customAesthetic ? CUSTOM_PALETTE_RULES : HOUSE_PALETTE_RULES;
  const provenance = tasteSkillAvailable()
    ? "(derived from your team's taste-skill; these are hard house rules, not suggestions)"
    : "(house design rules)";
  return [FRAME_RULES, "", palette, "", UNIVERSAL_RULES, "", provenance].join("\n");
}
