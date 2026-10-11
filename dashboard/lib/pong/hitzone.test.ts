import { describe, expect, it } from "vitest";
import { PADDLE_SKINS } from "./data";
import {
  BALL_RADIUS,
  buildGeometry,
  COURT_INSET,
  MAX_COURT_NUDGE,
  circleContact,
  localToWorld,
  pointInZone,
  poseForPaddle,
  worldToLocal,
  type WeaponGeometry,
} from "./hitzone";
import { MANIFEST } from "./manifest";
import { anticipationAngle, followAngle, predictContact, SWING, whiffAngle, whiffClock } from "./swing";

const geoms: Array<[string, WeaponGeometry]> = Object.keys(PADDLE_SKINS).map((id) => {
  const def = MANIFEST.weapons[id];
  return [id, buildGeometry(id, def, MANIFEST.sprites[def.sprite])];
});
geoms.push(["foe", buildGeometry("foe", MANIFEST.weapons.foe, MANIFEST.sprites[MANIFEST.weapons.foe.sprite])]);

const R = BALL_RADIUS;

describe("weapon hit zones", () => {
  it.each(geoms)("%s has a sane compound polygon", (_id, g) => {
    expect(g.polys.length).toBeGreaterThanOrEqual(3);
    for (const poly of g.polys) expect(poly.length / 2).toBeGreaterThanOrEqual(3);
    expect(g.bottom).toBeGreaterThan(g.top);
    // the grip pivot sits below the zone: the handle is not part of it
    expect(g.bottom).toBeLessThan(0);
  });

  it("round-trips world <-> sprite space under rotation, scale and mirror", () => {
    for (const mirror of [false, true]) {
      const pose = { px: 120, py: 240, scale: 0.43, angle: 0.37, mirror };
      const w = localToWorld(pose, 11, -37);
      const l = worldToLocal(pose, w.x, w.y);
      expect(l.x).toBeCloseTo(11, 6);
      expect(l.y).toBeCloseTo(-37, 6);
    }
  });

  it("scales the zone to the paddle height (Big Racket, Grow) with the face on the paddle edge", () => {
    const [, g] = geoms[0];
    for (const h of [80, 128, 200]) {
      const paddle = { x: 24, y: 100, w: 14, h };
      const pose = poseForPaddle(g, paddle, false, 0, 0);
      const top = localToWorld(pose, 0, g.top);
      const bottom = localToWorld(pose, 0, g.bottom);
      expect(top.y).toBeCloseTo(paddle.y, 4);
      expect(bottom.y).toBeCloseTo(paddle.y + h, 4);
      // front face sits on the paddle edge; only a wide head may be nudged forward to stay in court
      const face = localToWorld(pose, g.face, g.top).x;
      expect(face).toBeGreaterThanOrEqual(paddle.x + paddle.w - 1e-6);
      expect(face).toBeLessThanOrEqual(paddle.x + paddle.w + MAX_COURT_NUDGE + 1e-6);
      const ai = poseForPaddle(g, { x: 762, y: 100, w: 14, h }, true, 0, 0);
      const aiFace = localToWorld(ai, g.face, g.top).x;
      expect(aiFace).toBeLessThanOrEqual(762 + 1e-6);
      expect(aiFace).toBeGreaterThanOrEqual(762 - MAX_COURT_NUDGE - 1e-6);
    }
  });

  it.each(geoms)("%s head stays clear of the court wall at normal sizes", (_id, g) => {
    // 80 = base paddle, 128 = Big Racket, 1.6x power-up on the base. Past that the nudge cap wins.
    for (const h of [80, 100, 128]) {
      const left = poseForPaddle(g, { x: 24, y: 100, w: 14, h }, false, 0, 0);
      const backL = left.px + g.left * left.scale;
      expect(backL, `${h} player`).toBeGreaterThanOrEqual(COURT_INSET - 1e-6);
      const right = poseForPaddle(g, { x: 762, y: 100, w: 14, h }, true, 0, 0);
      const backR = right.px - g.left * right.scale;
      expect(backR, `${h} foe`).toBeLessThanOrEqual(800 - COURT_INSET + 1e-6);
    }
  });

  it("every contact point lies inside the rendered hit zone", () => {
    let contacts = 0;
    for (const [id, g] of geoms) {
      for (const mirror of [false, true]) {
        for (const h of [80, 112, 176]) {
          for (const angle of [-0.5, -0.2, 0, 0.1, 0.45, 0.85]) {
            const paddle = { x: mirror ? 786 : 24, y: 150, w: 14, h };
            const pose = poseForPaddle(g, paddle, mirror, angle, 0);
            // fire balls across the whole paddle height and a bit beyond
            for (let oy = -20; oy <= h + 20; oy += 4) {
              const dir = mirror ? 1 : -1;
              let x = mirror ? paddle.x - 240 : paddle.x + 240;
              const y = paddle.y + oy;
              for (let i = 0; i < 960; i++, x += dir * 0.5) {
                const c = circleContact(g, pose, x, y, R);
                if (!c) continue;
                contacts++;
                // contact point is on/in the zone...
                expect(pointInZone(g, pose, c.x, c.y, 1e-3), `${id} mirror=${mirror} h=${h} a=${angle} oy=${oy}`).toBe(true);
                // ...and the ball circle touches it (first-touch: nearly tangent, never deeper than a step)
                expect(Math.hypot(x - c.x, y - c.y)).toBeLessThanOrEqual(R + 1e-6);
                expect(c.depth).toBeLessThanOrEqual(0.5 + 1e-6);
                // the normal points from the zone toward the ball
                expect((x - c.x) * c.nx + (y - c.y) * c.ny).toBeGreaterThanOrEqual(-1e-6);
                break;
              }
            }
          }
        }
      }
    }
    expect(contacts).toBeGreaterThan(1000);
  });

  it("handle and empty space are not hits", () => {
    for (const [id, g] of geoms) {
      const paddle = { x: 24, y: 150, w: 14, h: 80 };
      const pose = poseForPaddle(g, paddle, false, 0, 0);
      // ball sitting on the grip (the handle). The orb is wider than the handle, so
      // it may graze the guard end of the blade; it is never a deep or sweet hit.
      const onGrip = circleContact(g, pose, pose.px, pose.py, R);
      if (onGrip) {
        expect(onGrip.along, `${id} grip graze is at the guard end`).toBeGreaterThan(0.9);
        expect(onGrip.depth, `${id} grip graze is shallow`).toBeLessThan(0.6);
        expect(onGrip.sweet, `${id} grip is not a sweet spot`).toBe(false);
      }
      // ball resting just below the guard, on the handle only
      expect(circleContact(g, pose, pose.px, pose.py + R + 4, R), `${id} handle`).toBeNull();
      // below the pommel
      expect(circleContact(g, pose, pose.px, pose.py + 60, R), `${id} pommel`).toBeNull();
      // above the tip / well in front of the face
      expect(circleContact(g, pose, paddle.x + paddle.w + 40, paddle.y + 40, R), `${id} air`).toBeNull();
      expect(circleContact(g, pose, paddle.x + 10, paddle.y - 30, R), `${id} above`).toBeNull();
    }
  });

  it("flags the centre of the blade as the sweet spot and the tip as not", () => {
    const [, g] = geoms[0]; // iron sword: sweet spot mid-blade
    const paddle = { x: 24, y: 150, w: 14, h: 80 };
    const pose = poseForPaddle(g, paddle, false, 0, 0);
    const mid = paddle.y + 80 * g.sweetV;
    const tip = paddle.y + 4;
    const hit = (y: number) => {
      for (let x = 120; x > 0; x -= 0.25) {
        const c = circleContact(g, pose, x, y, R);
        if (c) return c;
      }
      return null;
    };
    expect(hit(mid)?.sweet).toBe(true);
    expect(hit(tip)?.sweet).toBe(false);
  });
});

describe("swing timing", () => {
  it("is back at rest outside the window and lands on the contact tilt", () => {
    expect(anticipationAngle(SWING.window + 0.01)).toBe(0);
    expect(anticipationAngle(0)).toBeCloseTo(SWING.contactAngle, 10);
    expect(followAngle(0)).toBeCloseTo(SWING.contactAngle, 10);
    expect(followAngle(10)).toBe(0);
    expect(whiffAngle(10)).toBe(0);
    // the blade is wound back before it is released
    expect(anticipationAngle(SWING.window * 0.5)).toBeLessThan(0);
  });

  it("starts a whiff so the cut meets the ball at the plane, not after it", () => {
    expect(whiffClock(SWING.whiffWind + 0.02)).toBeNull();
    expect(whiffClock(-0.04)).toBeNull();
    // a full wind-up away: animation starts at rest
    expect(whiffClock(SWING.whiffWind)).toBeCloseTo(0, 5);
    // ball on the plane: the cut is just beginning (slightly late, not early)
    expect(whiffClock(0)).toBeCloseTo(SWING.whiffWind, 5);
    expect(whiffAngle(whiffClock(0) as number)).toBeCloseTo(SWING.windupAngle, 5);
    // a frame past the plane still counts as the same swing, not a new late one
    const late = whiffClock(-0.01);
    expect(late).not.toBeNull();
    expect(late as number).toBeGreaterThan(SWING.whiffWind);
  });

  it("predicts contact so the swing lands on the same frame as the ball", () => {
    for (const [id, g] of geoms) {
      for (const speed of [5, 9, 16, 28]) {
        const paddle = { x: 24, y: 160, w: 14, h: 80 };
        const ball = { x: 420, y: paddle.y + 40, vx: -speed, vy: 0, r: R };
        const dt = 1 / 60;
        let predictedAt: number | null = null;
        let hitAt: number | null = null;
        let elapsed = 0;
        let predictedFirst: number | null = null;
        for (let f = 0; f < 400 && hitAt === null; f++, elapsed += dt) {
          const p = predictContact(g, paddle, false, ball, { courtH: 500, speedFactor: 1, horizon: 0.3 });
          if (p && predictedFirst === null && p.tau <= SWING.window) {
            predictedFirst = elapsed;
            predictedAt = elapsed + p.tau;
          }
          const angle = p ? anticipationAngle(p.tau) : 0;
          const pose = poseForPaddle(g, paddle, false, angle, 0);
          if (circleContact(g, pose, ball.x, ball.y, R)) hitAt = elapsed;
          ball.x += ball.vx;
        }
        expect(hitAt, `${id} @${speed}`).not.toBeNull();
        expect(predictedAt).not.toBeNull();
        // contact lands within one frame of the prediction made in the window
        expect(Math.abs((hitAt as number) - (predictedAt as number))).toBeLessThanOrEqual(dt * 1.5);
      }
    }
  });

  it("predicts a miss when the ball goes over the weapon", () => {
    const [, g] = geoms[0];
    const paddle = { x: 24, y: 300, w: 14, h: 80 };
    const ball = { x: 400, y: 40, vx: -10, vy: 0, r: R };
    expect(predictContact(g, paddle, false, ball, { courtH: 500, speedFactor: 1, horizon: 0.5 })).toBeNull();
  });
});
