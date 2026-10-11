// Where the familiar and the hit numbers go. Pure geometry so the renderer and
// the tests agree: the familiar lives in the margin beside the court (never on
// the field, never near the blade), and damage numbers never land on the blade.

import type { Pt } from "./hitzone";

// ── familiar rail ────────────────────────────────────────────────────────

/**
 * Margin reserved beside the court's player-side wall for the familiar, world
 * px. The stylesheet reserves the same fraction of the court width, so the pet
 * is on screen at any window width.
 */
export const PET_RAIL_W = 152;
/**
 * The foe's slimmer rail on the other side of the court: its guardian and level,
 * plus the run controls. Together with PET_RAIL_W it is 0.28 of the court width,
 * the same budget the familiar rail alone used to take, so the court does not shrink.
 */
export const FOE_RAIL_W = 72;
/** Clear px between the pet and the frame's gold border. */
export const PET_EDGE_GAP = 8;
/** Clear px between the pet and the rail's outer edge. */
export const PET_RAIL_PAD = 6;
/** Keep the pet's head below this y (the rail is as tall as the court). */
export const PET_TOP_INSET = 8;

/** Ability cast: the pet dashes to the frame, then the effect enters the court. */
export const CAST_DASH = 0.08;
export const CAST_FLIGHT = 0.16;
export const CAST_TOTAL = CAST_DASH + CAST_FLIGHT;
/** Clear px between the cast lane and the weapon's tip / pommel. */
export const CAST_LANE_CLEAR = 46;

export interface RailSpec {
  petW: number;
  petH: number;
  /** Fraction of the drawn height above the feet anchor (the sprite's ay). */
  feetAnchor: number;
  courtH: number;
  /** The frame's gold border in world px: it grows as the window shrinks. */
  frameGap: number;
}

/** Centre-x range and feet-y range the pet may occupy. Always left of the court. */
export interface RailBounds { xMin: number; xMax: number; yMin: number; yMax: number }

export function railBounds(s: RailSpec): RailBounds {
  const half = s.petW / 2;
  const xMax = -(s.frameGap + PET_EDGE_GAP + half);
  const xMin = Math.min(xMax, -(PET_RAIL_W - PET_RAIL_PAD - half));
  return {
    xMin,
    xMax,
    yMin: PET_TOP_INSET + s.petH * s.feetAnchor,
    yMax: s.courtH - 6,
  };
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where the pet idles. It tracks the player's weapon along the rail with a
 * slow stroll across the rail's width so it reads as alive, not parked.
 * `t` is presentation time in seconds.
 */
export function railRest(b: RailBounds, paddleCentreY: number, petH: number, t: number): Pt {
  const mid = (b.xMin + b.xMax) / 2;
  const amp = (b.xMax - b.xMin) / 2;
  const sway = 0.65 * Math.sin(t * 0.55 + 0.7) + 0.35 * Math.sin(t * 1.43);
  return {
    x: clampTo(mid + amp * sway, b.xMin, b.xMax),
    // feet a little below the weapon's centre so the body is level with the blade
    y: clampTo(paddleCentreY + petH * 0.42, b.yMin, b.yMax),
  };
}

/** Feet y of the lane the cast flies along: above the weapon tip, or below the pommel when there is no room. */
export function castLane(weaponTop: number, weaponBottom: number, b: RailBounds, petH: number): number {
  // body centre of the pet sits on the lane; the feet are petH * 0.42 lower
  const above = weaponTop - CAST_LANE_CLEAR;
  const below = weaponBottom + CAST_LANE_CLEAR;
  const lift = petH * 0.42;
  const bodyMin = b.yMin - lift;
  const bodyMax = b.yMax - lift;
  if (above >= bodyMin) return clampTo(above, bodyMin, bodyMax) + lift;
  if (below <= bodyMax) return clampTo(below, bodyMin, bodyMax) + lift;
  // a very tall weapon (Big Racket + Grow) leaves no clear lane: take the roomier side
  return (weaponTop - bodyMin > bodyMax - weaponBottom ? bodyMin : bodyMax) + lift;
}

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/** 0..1 progress of the dash to the frame (reaches 1 at CAST_DASH). */
export function castDashProgress(t: number): number {
  return easeOutCubic(clampTo(t / CAST_DASH, 0, 1));
}

/** 0..1 progress of the effect from the frame edge to its origin (0 until the dash lands). */
export function castFlightProgress(t: number): number {
  return clampTo((t - CAST_DASH) / CAST_FLIGHT, 0, 1);
}

/**
 * The cast effect's path from the frame edge to the point it takes effect:
 * a quadratic arc that holds the lane until it has passed the weapon's front
 * edge, then drops to the origin. `u` is 0..1.
 */
export function castPath(from: Pt, to: Pt, weaponRight: number, u: number): Pt {
  const cx = Math.max(weaponRight + 14, (from.x + to.x) / 2);
  const k = 1 - u;
  return {
    x: k * k * from.x + 2 * k * u * cx + u * u * to.x,
    // u^3 keeps it in the lane until x is past the weapon, then swoops to the origin
    y: from.y + (to.y - from.y) * u * u * u,
  };
}

// ── floating hit numbers ─────────────────────────────────────────────────

/** Toward-centre and upward offsets of a damage number from the contact point. */
export const DAMAGE_DX = 74;
export const DAMAGE_DY = 36;
export const DAMAGE_RISE = 78;
export const DAMAGE_LIFE = 0.6;

/**
 * Damage numbers spawn toward the court centre and above the contact so they
 * never sit on the blade. `dir` is +1 when the weapon is on the left. The
 * familiar lives in the margin outside the court, so nothing else is in the way.
 */
export function damageTextSpot(c: Pt, dir: 1 | -1, minX: number, maxX: number): Pt {
  return { x: Math.min(maxX, Math.max(minX, c.x + dir * DAMAGE_DX)), y: c.y - DAMAGE_DY };
}

/**
 * Vertical offsets (relative to the number's centre) for a number and the
 * label stacked over it. Uses the popped size so the label clears the number
 * at the peak of its scale-in.
 */
export function floatTextLayout(size: number, pop: number, hasSub: boolean) {
  const numSize = size * pop;
  const subSize = Math.max(9, size * 0.42);
  const gap = 5;
  const subY = hasSub ? -(numSize * 0.5 + gap + subSize * 0.5) : 0;
  return { numSize, subSize, subY };
}
