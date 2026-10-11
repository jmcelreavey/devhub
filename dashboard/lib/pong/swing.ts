// Weapon swing timing.
//
// The swing is a pure function of "time until the ball touches the blade", so
// the sweet spot reaches the ball on the contact frame by construction —
// whatever the ball speed, slow-motion or hit-stop does to the clock.

import { circleContact, poseForPaddle, type PaddleRect, type WeaponGeometry } from "./hitzone";

/** Radians, positive = tip toward the opponent. */
export const SWING = {
  /** Anticipation starts this long (seconds) before the predicted contact. */
  window: 0.12,
  windupAngle: -0.5,
  contactAngle: 0.1,
  followAngle: 0.85,
  followIn: 0.085,
  followHold: 0.05,
  followOut: 0.22,
  whiffIn: 0.07,
  whiffWind: 0.08,
  whiffOut: 0.2,
} as const;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
const easeInQuad = (t: number) => t * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Blade angle `tau` seconds before contact (tau <= window), or 0 outside it. */
export function anticipationAngle(tau: number): number {
  if (tau >= SWING.window) return 0;
  const s = clamp01(tau / SWING.window); // 1 far .. 0 contact
  const split = 0.55;
  if (s > split) {
    const u = (1 - s) / (1 - split);
    return SWING.windupAngle * easeOutCubic(u);
  }
  const u = 1 - s / split;
  return SWING.windupAngle + (SWING.contactAngle - SWING.windupAngle) * easeInQuad(u);
}

export const FOLLOW_TOTAL = SWING.followIn + SWING.followHold + SWING.followOut;

/** Follow-through `t` seconds after contact, back to rest. */
export function followAngle(t: number): number {
  if (t <= 0) return SWING.contactAngle;
  if (t < SWING.followIn) {
    return SWING.contactAngle + (SWING.followAngle - SWING.contactAngle) * easeOutQuad(t / SWING.followIn);
  }
  if (t < SWING.followIn + SWING.followHold) return SWING.followAngle;
  const u = (t - SWING.followIn - SWING.followHold) / SWING.followOut;
  return u >= 1 ? 0 : SWING.followAngle * (1 - easeInOut(u));
}

export const WHIFF_TOTAL = SWING.whiffWind + SWING.whiffIn + SWING.whiffOut;

/**
 * Whiff animation clock when the ball is `eta` seconds from the contact plane.
 * The cut (after the wind-up) begins as the ball arrives, so the swing travels
 * with the ball and finishes slightly late. Null when it is too early to wind
 * up, or the ball has already gone past.
 */
export function whiffClock(eta: number): number | null {
  const lead = SWING.whiffWind;
  if (eta < -0.012 || eta > lead) return null;
  return lead - eta;
}

/** A swing at nothing: wind back, cut through, recover. */
export function whiffAngle(t: number): number {
  if (t <= 0) return 0;
  if (t < SWING.whiffWind) return SWING.windupAngle * easeOutCubic(t / SWING.whiffWind);
  const t2 = t - SWING.whiffWind;
  if (t2 < SWING.whiffIn) {
    return SWING.windupAngle + (SWING.followAngle - SWING.windupAngle) * easeInQuad(t2 / SWING.whiffIn);
  }
  const u = (t2 - SWING.whiffIn) / SWING.whiffOut;
  return u >= 1 ? 0 : SWING.followAngle * (1 - easeInOut(u));
}

export interface BallState {
  x: number;
  y: number;
  /** px per frame at 60fps, like the game's own ball velocity. */
  vx: number;
  vy: number;
  r: number;
}

export interface Prediction {
  /** Seconds until the ball touches the zone. */
  tau: number;
  x: number;
  y: number;
  sweet: boolean;
}

/**
 * Where and when `ball` first touches the weapon, assuming it keeps its
 * velocity (bouncing off the top/bottom walls) and the paddle stays put. The
 * weapon is evaluated at its contact tilt, i.e. the pose it will actually have
 * on the contact frame.
 */
export function predictContact(
  g: WeaponGeometry,
  paddle: PaddleRect,
  mirror: boolean,
  ball: BallState,
  opts: { courtH: number; speedFactor: number; horizon: number; recoil?: number },
): Prediction | null {
  const towards = mirror ? ball.vx > 0 : ball.vx < 0;
  if (!towards) return null;
  const pose = poseForPaddle(g, paddle, mirror, SWING.contactAngle, opts.recoil ?? 0);
  const step = 1 / 240; // seconds
  let x = ball.x;
  let y = ball.y;
  let vy = ball.vy;
  const vxs = ball.vx * 60 * opts.speedFactor; // px/s
  for (let t = 0; t <= opts.horizon; t += step) {
    const c = circleContact(g, pose, x, y, ball.r);
    if (c) return { tau: t, x: c.x, y: c.y, sweet: c.sweet };
    x += vxs * step;
    y += vy * 60 * opts.speedFactor * step;
    if (y - ball.r < 0) { y = ball.r; vy = Math.abs(vy); }
    if (y + ball.r > opts.courtH) { y = opts.courtH - ball.r; vy = -Math.abs(vy); }
    // past the weapon with no touch: it is a miss
    if (mirror ? x - ball.r > pose.px + 120 : x + ball.r < pose.px - 120) break;
  }
  return null;
}
