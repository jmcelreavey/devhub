import { describe, expect, it } from "vitest";
import { H, PADDLE_SKINS, W } from "./data";
import { buildGeometry, poseForPaddle } from "./hitzone";
import { MANIFEST } from "./manifest";
import {
  CAST_DASH,
  CAST_FLIGHT,
  CAST_TOTAL,
  castDashProgress,
  castFlightProgress,
  castLane,
  castPath,
  damageTextSpot,
  DAMAGE_DX,
  DAMAGE_LIFE,
  DAMAGE_RISE,
  floatTextLayout,
  FOE_RAIL_W,
  PET_RAIL_W,
  railBounds,
  railRest,
} from "./placement";

const PET_SIZES = [{ w: 82, name: "dragon" }, { w: 94, name: "turtle" }, { w: 110, name: "bat" }];
const PET_H = 96;
const ANCHOR = 0.96;
const PADDLE_H = 80;
/** Glow around the cast orb, so "clear" means clear of the glow too. */
const ORB_GLOW = 14;

function extentFor(id: string, y: number, h = PADDLE_H) {
  const def = MANIFEST.weapons[id];
  const g = buildGeometry(id, def, MANIFEST.sprites[def.sprite]);
  const pose = poseForPaddle(g, { x: 24, y, w: 14, h }, false, 0, 0);
  return {
    top: Math.min(y, pose.py - g.ay * g.h * pose.scale),
    bottom: pose.py + (1 - g.ay) * g.h * pose.scale,
    right: pose.px + (1 - g.ax) * g.w * pose.scale,
  };
}

function bounds(petW: number, frameGap = 9) {
  return railBounds({ petW, petH: PET_H, feetAnchor: ANCHOR, courtH: H, frameGap });
}

describe("familiar rail", () => {
  it.each(PET_SIZES)("$name rests fully outside the court and inside the rail at every paddle height and time", ({ w }) => {
    for (const frameGap of [4, 9, 16]) {
      const b = bounds(w, frameGap);
      for (let cy = 0; cy <= H; cy += 25) {
        for (let t = 0; t < 40; t += 0.37) {
          const p = railRest(b, cy, PET_H, t);
          // never over the court or its gold frame
          expect(p.x + w / 2).toBeLessThanOrEqual(-frameGap);
          // never past the margin the stylesheet reserves
          expect(p.x - w / 2).toBeGreaterThanOrEqual(-PET_RAIL_W);
          // on screen vertically: the head is below the top and the feet above the bottom
          expect(p.y - PET_H * ANCHOR).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(H);
        }
      }
    }
  });

  it("follows the weapon along the rail", () => {
    const b = bounds(94);
    const high = railRest(b, 120, PET_H, 0);
    const low = railRest(b, 380, PET_H, 0);
    expect(low.y - high.y).toBeGreaterThan(200);
  });

  it("strolls: x changes over time but stays in the rail", () => {
    const b = bounds(82);
    const xs = Array.from({ length: 60 }, (_, i) => railRest(b, 250, PET_H, i * 0.5).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
  });
});

describe("rail layout budget", () => {
  // The stylesheet fits court + both rails into (viewport - 16px). At 1024 wide the old single
  // familiar rail (160 plus a 60px right gutter for the corner buttons) left the court
  // (1024 - 84) / 1.2 = 783 css px; adding the foe's rail must not take more than that, or it shrinks.
  it("the foe rail does not shrink the court at 1024 wide", () => {
    const OLD_RAIL = 160;
    const old = (1024 - 84) / (1 + OLD_RAIL / W);
    const now = (1024 - 16) / (1 + (PET_RAIL_W + FOE_RAIL_W) / W);
    expect(now).toBeGreaterThanOrEqual(old);
  });

  it("the foe's rail is the slim one and still fits its controls at the narrowest layout", () => {
    expect(FOE_RAIL_W).toBeLessThan(PET_RAIL_W);
    // at 760 wide the court is ~590 css px; the rail's inner width must hold a 32px button
    const court = (760 - 16) / (1 + (PET_RAIL_W + FOE_RAIL_W) / W);
    const inner = court * (FOE_RAIL_W / W) - 14;
    expect(inner).toBeGreaterThanOrEqual(32);
  });
});

describe("familiar cast", () => {
  it("dash plus effect entry fits the 0.4 s budget", () => {
    expect(CAST_TOTAL).toBeLessThanOrEqual(0.4);
    expect(CAST_DASH).toBeLessThanOrEqual(0.2);
    expect(castDashProgress(0)).toBe(0);
    expect(castDashProgress(CAST_DASH)).toBe(1);
    expect(castFlightProgress(CAST_DASH * 0.5)).toBe(0);
    expect(castFlightProgress(CAST_DASH + CAST_FLIGHT / 2)).toBeCloseTo(0.5, 5);
    expect(castFlightProgress(CAST_TOTAL + 0.001)).toBe(1);
  });

  it.each(Object.keys(PADDLE_SKINS))("%s: the lane keeps the pet and the cast path clear of the blade", (id) => {
    for (const petW of [82, 110]) {
      const b = bounds(petW);
      for (let y = 0; y <= H - PADDLE_H; y += 10) {
        const ext = extentFor(id, y);
        const lane = castLane(ext.top, ext.bottom, b, PET_H);
        // the pet's body (feet - 0.42 H is its centre) is on screen
        expect(lane).toBeGreaterThanOrEqual(b.yMin);
        expect(lane).toBeLessThanOrEqual(b.yMax);
        const body = lane - PET_H * 0.42;
        const room = ext.top - 46 >= b.yMin - PET_H * 0.42 || ext.bottom + 46 <= b.yMax - PET_H * 0.42;
        if (!room) continue;
        // the lane is above the tip or below the pommel, never level with the weapon
        expect(body <= ext.top - 40 || body >= ext.bottom + 40).toBe(true);

        // the path from the frame edge to the effect origin (beside the blade, level with its middle)
        const from = { x: b.xMax + petW / 2, y: body };
        const to = { x: 96, y: y + PADDLE_H / 2 };
        for (let u = 0; u <= 1.0001; u += 0.02) {
          const p = castPath(from, to, ext.right, u);
          if (p.x > ext.right + ORB_GLOW) continue; // already past the weapon's front edge
          expect(p.y + ORB_GLOW <= ext.top || p.y - ORB_GLOW >= ext.bottom).toBe(true);
        }
      }
    }
  });

  it("path starts at the frame edge and ends at the effect origin", () => {
    const from = { x: -20, y: 100 };
    const to = { x: 96, y: 250 };
    expect(castPath(from, to, 55, 0)).toEqual(from);
    const end = castPath(from, to, 55, 1);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
  });

  it("with no clear lane (Big Racket + Grow) it stays on screen", () => {
    const b = bounds(94);
    for (let y = 0; y <= H - 240; y += 10) {
      const ext = extentFor("classic", y, 240);
      const lane = castLane(ext.top, ext.bottom, b, PET_H);
      expect(lane).toBeGreaterThanOrEqual(b.yMin);
      expect(lane).toBeLessThanOrEqual(b.yMax);
    }
  });
});

describe("hit numbers", () => {
  it("spawn toward the court centre and above the contact, clear of the blade", () => {
    const c = { x: 38, y: 250 };
    const s = damageTextSpot(c, 1, -140, W + 140);
    expect(s.x - c.x).toBeGreaterThanOrEqual(DAMAGE_DX - 0.001);
    expect(s.y).toBeLessThan(c.y);
  });

  it("floats up and out within about 0.6 s", () => {
    expect(DAMAGE_LIFE).toBeLessThanOrEqual(0.65);
    expect(DAMAGE_RISE * DAMAGE_LIFE).toBeGreaterThan(30);
  });

  it("stacks the SWEET SPOT label above the number with clear spacing, even at peak pop", () => {
    for (const pop of [1, 1.35, 1.7]) {
      const l = floatTextLayout(30, pop, true);
      const numTop = -l.numSize * 0.5;
      const subBottom = l.subY + l.subSize * 0.5;
      expect(subBottom).toBeLessThanOrEqual(numTop - 4);
    }
    expect(floatTextLayout(30, 1, false).subY).toBe(0);
  });
});
