// Weapon hit zones.
//
// The ball collides with the weapon *as drawn*: the blade/head silhouette from
// the asset manifest (compound convex polygons in sprite space), placed by the
// same pose the renderer uses. Nothing here knows about canvases — it is pure
// geometry so the debug overlay, the renderer and the tests share one answer.

import type { SpriteDef, WeaponDef } from "./manifest";

export interface Pt { x: number; y: number }

/**
 * Orb radius in court px. The sprite is drawn so its orb circle is exactly this
 * radius, so it is also the collision radius: what you see touch the blade is
 * what hits. Pass 4 doubled it (was 8) because the orb read as a speck.
 */
export const BALL_RADIUS = 16;
/** Split / sub-balls are slightly smaller than the main orb. */
export const BALL_RADIUS_MINI = 14;
/** Reach used for gem and monster pickups: kept at the original 8px orb so balance does not move. */
export const BALL_PICKUP_RADIUS = 8;

/** Sprite-space geometry for one weapon, in 1x sprite pixels relative to the grip. */
export interface WeaponGeometry {
  id: string;
  /** Sprite size at 1x. */
  w: number;
  h: number;
  /** Grip pivot, normalised. */
  ax: number;
  ay: number;
  /** Hit zone polygons as [x, y] in px relative to the pivot. */
  polys: Float64Array[];
  /** Vertical extent of the zone in px relative to the pivot (top < bottom). */
  top: number;
  bottom: number;
  /** Front face in px relative to the pivot. */
  face: number;
  /** Back-most x of the zone in px relative to the pivot (negative). */
  back: number;
  /** Back-most x of the whole sprite (head, lobes) in px relative to the pivot (negative). */
  left: number;
  /** Sweet spot band as fractions of the zone, measured from the tip. */
  sweetV: number;
  sweetHalf: number;
}

/** Where a weapon sits in the world. `angle` is the world rotation about the pivot. */
export interface WeaponPose {
  px: number;
  py: number;
  scale: number;
  angle: number;
  /** Faces left (the AI's weapon). */
  mirror: boolean;
}

export interface Contact {
  /** Closest point on the zone to the ball centre, world space. */
  x: number;
  y: number;
  /** Unit normal pointing from the weapon toward the ball. */
  nx: number;
  ny: number;
  /** Penetration of the ball circle into the zone (>= 0). */
  depth: number;
  /** 0 at the tip, 1 at the bottom of the zone. */
  along: number;
  sweet: boolean;
}

export function buildGeometry(id: string, def: WeaponDef, sprite: SpriteDef): WeaponGeometry {
  const ax = sprite.anchor?.x ?? 0.5;
  const ay = sprite.anchor?.y ?? 0.8;
  const polys: Float64Array[] = [];
  let top = Infinity;
  let bottom = -Infinity;
  let face = -Infinity;
  let back = Infinity;
  for (const poly of def.polys) {
    const a = new Float64Array(poly.length * 2);
    poly.forEach(([u, v], i) => {
      const x = (u - ax) * sprite.w;
      const y = (v - ay) * sprite.h;
      a[i * 2] = x;
      a[i * 2 + 1] = y;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      face = Math.max(face, x);
      back = Math.min(back, x);
    });
    polys.push(a);
  }
  const left = Math.min(back, -ax * sprite.w);
  return { id, w: sprite.w, h: sprite.h, ax, ay, polys, top, bottom, face, back, left, sweetV: def.sweet.v, sweetHalf: def.sweet.half };
}

/** Clear px between the court wall and the weapon's back edge (rim glow included). */
export const COURT_INSET = 9;
/** Most a wide head may push the weapon forward to honour COURT_INSET. */
export const MAX_COURT_NUDGE = 36;

export interface PaddleRect { x: number; y: number; w: number; h: number }

/**
 * Pose that lays the weapon's hit zone over the logical paddle: zone height ==
 * paddle height (so Big Racket and Grow scale the weapon), front face on the
 * paddle's front edge, grip below holding it. `angle` tilts about the grip.
 * `recoil` slides it away from the opponent (px).
 */
export function poseForPaddle(
  g: WeaponGeometry,
  p: PaddleRect,
  mirror: boolean,
  angleForward: number,
  recoil: number,
  courtW = 800,
): WeaponPose {
  const scale = p.h / (g.bottom - g.top);
  let px = mirror ? p.x + g.face * scale + recoil : p.x + p.w - g.face * scale - recoil;
  // A wide head (axe, hammer) must sit fully inside the court, clear of the gold
  // frame and its own rim glow. Nudge the weapon forward by the overhang. The
  // cap keeps the contact plane near the original paddle's; only Big Racket +
  // Grow stacks hit it, and then the head is clipped by the frame, not the face.
  const reach = g.left * scale;
  if (mirror) px = Math.max(px - MAX_COURT_NUDGE, Math.min(px, courtW - COURT_INSET + reach));
  else px = Math.min(px + MAX_COURT_NUDGE, Math.max(px, COURT_INSET - reach));
  const py = p.y - g.top * scale;
  return { px, py, scale, angle: mirror ? -angleForward : angleForward, mirror };
}

/** Sprite-local px (relative to pivot) -> world. */
export function localToWorld(pose: WeaponPose, lx: number, ly: number, out: Pt = { x: 0, y: 0 }): Pt {
  const sx = (pose.mirror ? -lx : lx) * pose.scale;
  const sy = ly * pose.scale;
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  out.x = pose.px + sx * c - sy * s;
  out.y = pose.py + sx * s + sy * c;
  return out;
}

/** World -> sprite-local px relative to the pivot. */
export function worldToLocal(pose: WeaponPose, wx: number, wy: number, out: Pt = { x: 0, y: 0 }): Pt {
  const dx = wx - pose.px;
  const dy = wy - pose.py;
  const c = Math.cos(-pose.angle);
  const s = Math.sin(-pose.angle);
  const rx = (dx * c - dy * s) / pose.scale;
  const ry = (dx * s + dy * c) / pose.scale;
  out.x = pose.mirror ? -rx : rx;
  out.y = ry;
  return out;
}

/** The hit zone in world space (debug overlay and tests; allocates). */
export function worldZone(g: WeaponGeometry, pose: WeaponPose): Pt[][] {
  return g.polys.map((poly) => {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i += 2) out.push(localToWorld(pose, poly[i], poly[i + 1]));
    return out;
  });
}

/** Distance from (cx, cy) to a convex polygon in 2-px-per-vertex flat form. */
function polyDistance(poly: Float64Array, cx: number, cy: number, res: { x: number; y: number; inside: boolean; d: number }) {
  const n = poly.length / 2;
  let inside = true;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = poly[i * 2];
    const y1 = poly[i * 2 + 1];
    const ex = poly[j * 2] - x1;
    const ey = poly[j * 2 + 1] - y1;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? ((cx - x1) * ex + (cy - y1) * ey) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + ex * t;
    const qy = y1 + ey * t;
    const d2 = (cx - qx) * (cx - qx) + (cy - qy) * (cy - qy);
    if (d2 < best) { best = d2; bx = qx; by = qy; }
    // convex hull from the pipeline is counter-clockwise in y-down space
    if ((cx - x1) * ey - (cy - y1) * ex > 0) inside = false;
  }
  res.x = bx;
  res.y = by;
  res.inside = inside;
  res.d = Math.sqrt(best);
}

const scratch = { x: 0, y: 0, inside: false, d: 0 };

/**
 * Circle (the ball) against the rendered zone. Returns null when they do not
 * touch. Works in sprite space — rotation, mirroring and uniform scale are
 * similarities — so a call is one transform plus a handful of edge tests.
 */
export function circleContact(g: WeaponGeometry, pose: WeaponPose, cx: number, cy: number, r: number): Contact | null {
  const lc = worldToLocal(pose, cx, cy);
  const lr = r / pose.scale;
  // cheap reject: outside the zone's bounding box grown by the radius
  if (lc.y < g.top - lr || lc.y > g.bottom + lr) return null;
  let bestD = Infinity;
  let bx = 0;
  let by = 0;
  let wasInside = false;
  for (const poly of g.polys) {
    polyDistance(poly, lc.x, lc.y, scratch);
    const d = scratch.inside ? 0 : scratch.d;
    if (d < bestD) { bestD = d; bx = scratch.x; by = scratch.y; wasInside = scratch.inside; }
  }
  if (bestD > lr) return null;
  const wp = localToWorld(pose, bx, by);
  let nx: number;
  let ny: number;
  const dx = cx - wp.x;
  const dy = cy - wp.y;
  const len = Math.hypot(dx, dy);
  if (len > 1e-6 && !wasInside) {
    nx = dx / len;
    ny = dy / len;
  } else {
    // centre is inside the zone: push out the way the weapon faces
    nx = pose.mirror ? -1 : 1;
    ny = 0;
  }
  const zoneH = g.bottom - g.top;
  const along = zoneH > 0 ? (by - g.top) / zoneH : 0;
  return {
    x: wp.x,
    y: wp.y,
    nx,
    ny,
    depth: Math.max(0, r - (wasInside ? -len : len)),
    along,
    sweet: Math.abs(along - g.sweetV) <= g.sweetHalf,
  };
}

/** Point-in-zone test with an optional outward tolerance (px, world units). */
export function pointInZone(g: WeaponGeometry, pose: WeaponPose, wx: number, wy: number, tol = 0): boolean {
  const lc = worldToLocal(pose, wx, wy);
  for (const poly of g.polys) {
    polyDistance(poly, lc.x, lc.y, scratch);
    if (scratch.inside || scratch.d * pose.scale <= tol) return true;
  }
  return false;
}
