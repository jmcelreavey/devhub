// Canvas effects for Pong Quest: anime impact frames, speed lines, JRPG damage
// numbers, coin pops and per-arena ambient particles. Pure drawing + small
// state records; the engine owns when things spawn.

import { floatTextLayout } from "@/lib/pong/placement";

export const UI_FONT = '"Hiragino Maru Gothic ProN","Arial Rounded MT Bold","Nunito","Varela Round","Trebuchet MS",system-ui,sans-serif';
export const DISPLAY_FONT = '"Palatino Linotype","Book Antiqua",Palatino,"Hiragino Mincho ProN",Georgia,serif';

export const PAL = {
  ink: "#120b24",
  panel: "#1d1238",
  gold: "#f6d37a",
  goldDeep: "#b98a2e",
  cream: "#fff4d6",
  rose: "#ff7aa8",
  mint: "#7be0b0",
  sky: "#7fd1ff",
  ruby: "#ff5a6e",
  violet: "#b79bff",
} as const;

// ── motion preference ────────────────────────────────────────────────────

let motionCache = { at: 0, ok: true };

/**
 * False when the user asked for less motion (OS setting) or turned DevHub's
 * animations off. Shake, flashes and speed lines check this.
 */
export function motionAllowed(): boolean {
  if (typeof window === "undefined") return true;
  const now = performance.now();
  if (now - motionCache.at < 400) return motionCache.ok;
  let ok = true;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) ok = false;
    if (document.body?.dataset.motion === "off") ok = false;
  } catch { /* noop */ }
  motionCache = { at: now, ok };
  return ok;
}

// ── records ──────────────────────────────────────────────────────────────

export interface FloatText {
  x: number; y: number; vy: number;
  t: number; life: number;
  text: string; fill: string; stroke: string; size: number;
  /** Pop-in scale boost that decays over the first ~90ms. */
  pop: number;
  sub?: string;
}

export interface AnimFx {
  x: number; y: number; t: number;
  anim: string;
  fps: number;
  scale: number;
  rot: number;
  alpha: number;
  additive?: boolean;
  flipX?: boolean;
}

export interface SpeedLines {
  x: number; y: number; t: number; life: number; len: number; seed: number;
}

export interface CoinPop {
  x: number; y: number; vx: number; vy: number; t: number; life: number; rot: number; spin: number;
}

export type AmbientKind = "dust" | "sakura" | "crystal" | "ember" | "bubble";
export interface Ambient {
  x: number; y: number; vx: number; vy: number; size: number; phase: number; kind: AmbientKind; rot: number;
}

// ── glow sprites ─────────────────────────────────────────────────────────

const glowCache = new Map<string, HTMLCanvasElement>();

/** Soft radial blob, cached per colour: far cheaper than a gradient per call. */
export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.globalAlpha = 1;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

// ── drawing helpers ──────────────────────────────────────────────────────

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.28;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** Outlined, slanted display text: the "damage number" look. */
export function drawJpText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke: string, alpha = 1, slant = -0.16) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.transform(1, 0, slant, 1, 0, 0);
  ctx.font = `900 ${size}px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.28);
  ctx.strokeStyle = "rgba(10,6,24,0.9)";
  ctx.strokeText(text, 0, 1);
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function drawFloatTexts(ctx: CanvasRenderingContext2D, items: FloatText[]) {
  for (const f of items) {
    const k = f.t / f.life;
    const pop = f.pop > 0 ? 1 + f.pop * Math.max(0, 1 - f.t / 0.09) : 1;
    const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const rise = f.vy * f.t;
    const lay = floatTextLayout(f.size, pop, !!f.sub);
    if (f.sub) drawJpText(ctx, f.sub, f.x, f.y + rise + lay.subY, lay.subSize, PAL.cream, "#7a3b00", a, -0.1);
    drawJpText(ctx, f.text, f.x, f.y + rise, lay.numSize, f.fill, f.stroke, a);
  }
}

/** Radial speed lines for hard hits: thin tapered spikes, bright at the root. */
export function drawSpeedLines(ctx: CanvasRenderingContext2D, items: SpeedLines[]) {
  for (const s of items) {
    const k = s.t / s.life;
    const a = Math.pow(1 - k, 0.6);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    const n = 30;
    for (let i = 0; i < n; i++) {
      // deterministic jitter so lines don't shimmer between frames
      const j = Math.sin((i + 1) * 12.9898 + s.seed * 78.233) * 43758.5453;
      const rnd = j - Math.floor(j);
      const ang = (i / n) * Math.PI * 2 + rnd * 0.12;
      const r0 = 20 + k * 26 + rnd * 12;
      const r1 = r0 + s.len * (0.35 + rnd * 0.65) * (1 - k * 0.4);
      const half = 0.016 + rnd * 0.022;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(ang - half) * r0, s.y + Math.sin(ang - half) * r0);
      ctx.lineTo(s.x + Math.cos(ang) * r1, s.y + Math.sin(ang) * r1);
      ctx.lineTo(s.x + Math.cos(ang + half) * r0, s.y + Math.sin(ang + half) * r0);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ── ambient particles ────────────────────────────────────────────────────

export const AMBIENT_FOR_COURT: Record<string, AmbientKind> = {
  midnight: "dust",
  synthwave: "sakura",
  terminal: "crystal",
  sunset: "ember",
  deep: "bubble",
};

/** Ambient density: clearly there, still calm. Reduced motion gets a still, sparser set. */
export const AMBIENT_COUNT = 64;
export const AMBIENT_COUNT_CALM = 24;

export function spawnAmbient(kind: AmbientKind, w: number, h: number, scatter: boolean): Ambient {
  const rnd = Math.random;
  const base: Ambient = { x: rnd() * w, y: rnd() * h, vx: 0, vy: 0, size: 1, phase: rnd() * Math.PI * 2, kind, rot: rnd() * Math.PI * 2 };
  switch (kind) {
    case "dust": // torch-lit motes drifting up and across the keep
      base.vx = 5 + rnd() * 9; base.vy = -5 - rnd() * 9; base.size = 1.7 + rnd() * 2.1;
      if (!scatter) { base.x = -6; }
      break;
    case "sakura":
      base.vx = 18 + rnd() * 22; base.vy = 14 + rnd() * 20; base.size = 3.6 + rnd() * 2.8;
      if (!scatter) { base.x = rnd() < 0.5 ? -6 : rnd() * w; base.y = -6; }
      break;
    case "crystal":
      base.vx = 0; base.vy = 0; base.size = 1.8 + rnd() * 2.4;
      break;
    case "ember":
      base.vx = (rnd() - 0.5) * 16; base.vy = -18 - rnd() * 28; base.size = 1.6 + rnd() * 2.2;
      if (!scatter) { base.y = h + 6; }
      break;
    case "bubble":
      base.vx = (rnd() - 0.5) * 6; base.vy = -8 - rnd() * 12; base.size = 2.2 + rnd() * 3.6;
      if (!scatter) { base.y = h + 8; }
      break;
  }
  return base;
}

export function updateAmbient(a: Ambient, dt: number, w: number, h: number, calm: number): boolean {
  a.phase += dt * (a.kind === "crystal" ? 2.2 : 1.6);
  a.rot += dt * (a.kind === "sakura" ? 2.4 : 0.6);
  if (a.kind === "crystal") return true; // twinkle in place
  const sway = a.kind === "sakura" ? Math.sin(a.phase) * 18 : a.kind === "bubble" ? Math.sin(a.phase * 1.3) * 8 : Math.sin(a.phase) * 5;
  a.x += (a.vx + sway) * dt * calm;
  a.y += a.vy * dt * calm;
  return a.x > -14 && a.x < w + 14 && a.y > -14 && a.y < h + 14;
}

/** Glow colour and strength per kind. Capped well under the ball's own glow (0.5). */
const AMBIENT_GLOW: Partial<Record<AmbientKind, { color: string; radius: number; alpha: number }>> = {
  dust: { color: "#ffb04a", radius: 4.2, alpha: 0.34 },
  ember: { color: "#ff7a2a", radius: 4.4, alpha: 0.36 },
  crystal: { color: "#b9a4ff", radius: 4.6, alpha: 0.34 },
  bubble: { color: "#7fd0ff", radius: 2.6, alpha: 0.18 },
  sakura: { color: "#ff9cc4", radius: 2.4, alpha: 0.16 },
};

/** Twinkle 0..1 for the kinds that pulse. */
function ambientPulse(a: Ambient): number {
  return 0.5 + 0.5 * Math.sin(a.phase * (a.kind === "ember" ? 2.2 : 1.3));
}

/** Particles this close to the top/bottom plate edge are skipped so none sits on the gold frame. */
const AMBIENT_EDGE = 8;

export function drawAmbient(ctx: CanvasRenderingContext2D, items: Ambient[], h = Infinity) {
  // pass 1: soft halos, additive, one composite switch for the whole layer
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const a of items) {
    if (a.y <= AMBIENT_EDGE || a.y >= h - AMBIENT_EDGE) continue;
    const g = AMBIENT_GLOW[a.kind];
    if (!g) continue;
    const k = a.kind === "crystal" ? Math.max(0, Math.sin(a.phase)) : 0.55 + 0.45 * ambientPulse(a);
    if (k < 0.04) continue;
    const r = a.size * g.radius;
    ctx.globalAlpha = g.alpha * k;
    ctx.drawImage(glowSprite(g.color), a.x - r, a.y - r, r * 2, r * 2);
  }
  ctx.restore();

  // pass 2: the particles themselves
  for (const a of items) {
    if (a.y <= AMBIENT_EDGE || a.y >= h - AMBIENT_EDGE) continue;
    switch (a.kind) {
      case "dust": {
        ctx.globalAlpha = 0.5 + 0.28 * ambientPulse(a);
        ctx.fillStyle = "#ffe2b0";
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 0.8, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "ember": {
        const k = ambientPulse(a);
        ctx.globalAlpha = 0.6 + 0.3 * k;
        ctx.fillStyle = k > 0.6 ? "#ffe08a" : "#ff8a3a";
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 0.9, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case "sakura": {
        ctx.globalAlpha = 0.88;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.rot);
        ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.sin(a.phase * 0.8)));
        ctx.fillStyle = "#ffc2dd";
        ctx.beginPath(); ctx.ellipse(0, 0, a.size, a.size * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ff9cc4";
        ctx.beginPath(); ctx.ellipse(a.size * 0.25, 0, a.size * 0.45, a.size * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case "crystal": {
        const tw = Math.max(0, Math.sin(a.phase));
        if (tw < 0.05) break;
        ctx.globalAlpha = Math.min(0.85, tw * 0.9);
        ctx.fillStyle = "#efe8ff";
        drawStar(ctx, a.x, a.y, a.size * (1 + tw), Math.PI / 4);
        break;
      }
      case "bubble": {
        ctx.globalAlpha = 0.62;
        ctx.strokeStyle = "#a9deff";
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#eaf8ff";
        ctx.fillRect(a.x - a.size * 0.45, a.y - a.size * 0.55, 1.6, 1.6);
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}
