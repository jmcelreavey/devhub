#!/usr/bin/env node
// Pong Quest asset pipeline.
//
//   node scripts/pong-assets/build.mjs [--src <dir>] [--out <dir>] [--qa <dir>] [--arenas-only]
//
// Slices the concept sheets, chroma-keys the magenta to clean alpha, trims, and
// writes 1x/2x WebP plus manifest.json (sprite sizes, anchors, weapon hit zones,
// animation frame lists) into dashboard/public/pong/. The sheets themselves are
// never copied into the bundle.
//
// Deterministic: same sheets in -> byte-identical files and manifest out.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { keyToRgba, fringeScore, tintAura, recolor, purgeMagenta } from "./lib/key.mjs";
import { convexHull, simplifyHull, polygonArea } from "./lib/geom.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const require = createRequire(path.join(repoRoot, "dashboard/package.json"));
const sharp = require("sharp");

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SRC = path.resolve(arg("src", process.env.PONG_ART_SRC ?? path.join(repoRoot, "../../autorun/pong-anime-src")));
const OUT = path.resolve(arg("out", path.join(repoRoot, "dashboard/public/pong")));
const QA = arg("qa", null);

const WEBP = { quality: 90, alphaQuality: 96, effort: 6, smartSubsample: true };
const WEBP_BG = { quality: 80, effort: 6, smartSubsample: true };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** @type {Record<string, any>} */
const manifest = { version: 1, sprites: {}, animations: {}, weapons: {}, arenas: {}, notes: {} };
const written = [];

async function loadSheet(file, keyOpts = {}) {
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) throw new Error(`missing concept sheet: ${p}`);
  const { data, info } = await sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { rgba, key } = keyToRgba(data, info.width, info.height, keyOpts);
  return { rgba, w: info.width, h: info.height, key, fringe: fringeScore(rgba, info.width, info.height) };
}

/** Column index with the least opaque mass within [nominal-win, nominal+win]. */
function findCut(sheet, nominal, win, y0, y1) {
  let best = nominal;
  let bestMass = Infinity;
  for (let x = Math.max(1, nominal - win); x <= Math.min(sheet.w - 2, nominal + win); x++) {
    let mass = 0;
    for (let y = y0; y < y1; y++) mass += sheet.rgba[(y * sheet.w + x) * 4 + 3] > 24 ? 1 : 0;
    // prefer the cut nearest the nominal when masses tie
    const score = mass * 1000 + Math.abs(x - nominal);
    if (score < bestMass) { bestMass = score; best = x; }
  }
  return best;
}

function findRowCut(sheet, nominal, win) {
  let best = nominal;
  let bestMass = Infinity;
  for (let y = Math.max(1, nominal - win); y <= Math.min(sheet.h - 2, nominal + win); y++) {
    let mass = 0;
    for (let x = 0; x < sheet.w; x++) mass += sheet.rgba[(y * sheet.w + x) * 4 + 3] > 24 ? 1 : 0;
    const score = mass * 1000 + Math.abs(y - nominal);
    if (score < bestMass) { bestMass = score; best = y; }
  }
  return best;
}

function bboxOf(sheet, x0, y0, x1, y1, thr = 10) {
  let a = Infinity, b = Infinity, c = -1, d = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (sheet.rgba[(y * sheet.w + x) * 4 + 3] > thr) {
        if (x < a) a = x;
        if (x > c) c = x;
        if (y < b) b = y;
        if (y > d) d = y;
      }
    }
  }
  if (c < 0) throw new Error(`empty cell ${x0},${y0}-${x1},${y1}`);
  return { x: a, y: b, w: c - a + 1, h: d - b + 1 };
}

/** Copy a rectangle of a sheet into a fresh RGBA buffer, optionally padded/placed. */
function cropRgba(sheet, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= sheet.h) continue;
    for (let col = 0; col < w; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= sheet.w) continue;
      const si = (sy * sheet.w + sx) * 4;
      const di = (row * w + col) * 4;
      out[di] = sheet.rgba[si]; out[di + 1] = sheet.rgba[si + 1]; out[di + 2] = sheet.rgba[si + 2]; out[di + 3] = sheet.rgba[si + 3];
    }
  }
  return out;
}

function rawImg(buf, w, h) {
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } });
}

/**
 * Write `<dir>/<name>.webp` (1x) and `<name>@2x.webp`. `h1x` is the 1x pixel
 * height; 2x is 2*h1x but never larger than the source (no fake resolution).
 */
async function emit(id, dir, name, buf, w, h, { h1x, w1x, opts = WEBP, extra = {} }) {
  const scale1 = w1x ? w1x / w : h1x / h;
  const w1 = Math.max(1, Math.round(w * scale1));
  const h1 = Math.max(1, Math.round(h * scale1));
  const want2 = Math.min(scale1 * 2, 1); // never upscale beyond the source
  const w2 = Math.max(w1, Math.round(w * want2));
  const h2 = Math.max(h1, Math.round(h * want2));
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  const f1 = path.join(dir, `${name}.webp`);
  const f2 = path.join(dir, `${name}@2x.webp`);
  await rawImg(buf, w, h).resize(w1, h1, { kernel: "lanczos3", fit: "fill" }).webp(opts).toFile(path.join(OUT, f1));
  await rawImg(buf, w, h).resize(w2, h2, { kernel: "lanczos3", fit: "fill" }).webp(opts).toFile(path.join(OUT, f2));
  written.push(f1, f2);
  manifest.sprites[id] = { file: `${dir}/${name}`, w: w1, h: h1, w2, h2, ...extra };
  return manifest.sprites[id];
}

// ---------------------------------------------------------------------------
// weapons
// ---------------------------------------------------------------------------

// Fractions are of the trimmed sprite height. `strike` is where the ball can
// connect: blade or head plus the haft down to the hand. `grip` is the pivot
// (centre of the wrapped grip). `sweet` is the sweet spot as a fraction of the
// strike zone measured from the tip (blade middle / the head itself).
const WEAPONS = [
  { id: "classic", cut: [0, 240], strike: 0.675, grip: 0.82, sweet: { v: 0.45, half: 0.2 } },
  { id: "neon", cut: [240, 425], strike: 0.675, grip: 0.81, sweet: { v: 0.45, half: 0.2 }, aura: [120, 196, 255] },
  { id: "inferno", cut: [425, 645], strike: 0.66, grip: 0.82, sweet: { v: 0.26, half: 0.2 } },
  { id: "matrix", cut: [645, 855], strike: 0.66, grip: 0.8, sweet: { v: 0.2, half: 0.17 } },
  { id: "royal", cut: [855, 1058], strike: 0.66, grip: 0.79, sweet: { v: 0.25, half: 0.2 } },
  { id: "gold", cut: [1058, 1280], strike: 0.675, grip: 0.82, sweet: { v: 0.45, half: 0.2 }, aura: [255, 226, 130] },
];

function weaponHitZone(sheet, box, strike) {
  // largest 8-connected component of solid pixels above the strike line
  const { x, y, w, h } = box;
  const yMax = y + Math.round(strike * h);
  const solid = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      solid[r * w + c] = y + r <= yMax && sheet.rgba[((y + r) * sheet.w + x + c) * 4 + 3] >= 200 ? 1 : 0;
    }
  }
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  const stack = [];
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i] || label[i] !== -1) continue;
    let size = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const px = p % w, py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (solid[q] && label[q] === -1) { label[q] = id; stack.push(q); }
        }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  // One convex hull per horizontal band => a tight compound polygon that
  // follows the silhouette (axe lobes, hammer overhang) without filling gaps.
  const bandH = Math.max(6, Math.round(h * 0.035));
  const polys = [];
  for (let r0 = 0; r0 <= yMax - y; r0 += bandH) {
    const pts = [];
    for (let r = r0; r < Math.min(r0 + bandH + 1, yMax - y + 1); r++) {
      for (let c = 0; c < w; c++) {
        if (label[r * w + c] === best) pts.push([c + 0.5, r + 0.5]);
      }
    }
    if (pts.length < 6) continue;
    const hull = simplifyHull(convexHull(pts), 8);
    if (hull.length < 3 || polygonArea(hull) < 4) continue;
    polys.push(hull.map(([px, py]) => [round4(px / w), round4(py / h)]));
  }
  return polys;
}

const round4 = (n) => Math.round(n * 10000) / 10000;

async function buildWeapons() {
  // Lower solid bar: the staff crystal is violet and sits close to the key.
  const sheet = await loadSheet("weapons.jpg", { solidFar: 105 });
  for (const wp of WEAPONS) if (wp.aura) tintAura(sheet.rgba, sheet.w, sheet.h, wp.aura, 0.85);
  // Magenta-on-blue and magenta-on-gold glows key ambiguously: pull lavender
  // haze back to the blade's own hue.
  recolor(sheet.rgba, sheet.w, sheet.h, {
    x0: 240, x1: 425,
    when: (r, g, b) => b > g + 12 && r > g + 18 && r > 120 && b > 150,
    to: (r, g, b) => [g * 0.72, g * 0.98, b],
  });
  recolor(sheet.rgba, sheet.w, sheet.h, {
    x0: 1058, x1: 1280,
    when: (r, g, b) => r > 200 && r - g > 28 && b > g - 25 && b < r - 10,
    to: (r, g, b) => [r, g + (r - g) * 0.55, Math.min(b, g * 0.6)],
  });
  manifest.notes.weaponsFringe = round4(sheet.fringe);
  for (const wp of WEAPONS) {
    const box = bboxOf(sheet, wp.cut[0], 0, wp.cut[1], sheet.h);
    const buf = cropRgba(sheet, box.x, box.y, box.w, box.h);
    const polys = weaponHitZone(sheet, box, wp.strike);
    if (polys.length < 3) throw new Error(`weapon ${wp.id}: hit zone extraction failed`);
    let faceU = 0;
    for (const poly of polys) for (const [u] of poly) faceU = Math.max(faceU, u);
    await emit(`weapon-${wp.id}`, "weapons", wp.id, buf, box.w, box.h, {
      h1x: 220,
      extra: { kind: "weapon", anchor: { x: round4(0.5), y: wp.grip } },
    });
    // grip pivot x = centre of the shaft at the grip row (not the bbox centre: auras skew it)
    const gy = box.y + Math.round(wp.grip * box.h);
    let gx0 = Infinity, gx1 = -1;
    for (let x = box.x; x < box.x + box.w; x++) {
      if (sheet.rgba[(gy * sheet.w + x) * 4 + 3] >= 200) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); }
    }
    const gripX = round4((((gx0 + gx1) / 2) - box.x) / box.w);
    manifest.sprites[`weapon-${wp.id}`].anchor = { x: gripX, y: wp.grip };
    manifest.weapons[wp.id] = {
      sprite: `weapon-${wp.id}`,
      strikeTop: 0,
      strikeBottom: wp.strike,
      faceU: round4(faceU),
      sweet: wp.sweet,
      polys,
    };
    if (wp.id === "classic") {
      // The AI's blade: same steel, crimson-forged.
      const red = Buffer.from(buf);
      for (let i = 0; i < red.length; i += 4) {
        const r = red[i], g = red[i + 1], b = red[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        red[i] = Math.min(255, Math.round(l * 1.05 + 28));
        red[i + 1] = Math.round(g * 0.42);
        red[i + 2] = Math.round(b * 0.46);
      }
      await emit("weapon-foe", "weapons", "foe", red, box.w, box.h, {
        h1x: 220,
        extra: { kind: "weapon", anchor: { x: gripX, y: wp.grip } },
      });
      manifest.weapons.foe = { ...manifest.weapons.classic, sprite: "weapon-foe" };
    }
  }
}

// ---------------------------------------------------------------------------
// balls + power-ups
// ---------------------------------------------------------------------------

/** Orb circle (centre, radius) inside a keyed cell, found from a colour test. */
function findOrb(sheet, box, test) {
  let a = Infinity, b = Infinity, c = -1, d = -1;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const o = (y * sheet.w + x) * 4;
      if (sheet.rgba[o + 3] > 200 && test(sheet.rgba[o], sheet.rgba[o + 1], sheet.rgba[o + 2])) {
        a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y);
      }
    }
  }
  if (c < 0) throw new Error("orb not found");
  return { cx: (a + c) / 2, cy: (b + d) / 2, r: Math.max(c - a, d - b) / 2 };
}

async function buildBalls() {
  const sheet = await loadSheet("balls-powerups.jpg");
  manifest.notes.ballsFringe = round4(sheet.fringe);
  // The void orb's red halo keys to a grey ring (red-on-magenta is ambiguous): re-tint it.
  tintAura(sheet.rgba, sheet.w, sheet.h, [236, 36, 58], 0.92, 245, { x0: 1030 });
  const rowCut = findRowCut(sheet, 345, 40);
  const topCuts = [0, 255, 545, 775, 1030, 1280].map((n, i, arr) => (i === 0 || i === arr.length - 1 ? n : findCut(sheet, n, 30, 0, rowCut)));
  const botCuts = [0, 256, 512, 768, 1024, 1280].map((n, i, arr) => (i === 0 || i === arr.length - 1 ? n : findCut(sheet, n, 30, rowCut, sheet.h)));

  // Ball orbs. Orb colour tests locate the collision circle inside effects.
  const orbTests = {
    classic: null, // whole sprite is the orb
    comet: (r, g, b) => r > 215 && g > 205 && b > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 60,
    plasma: (r, g, b) => r > 150 && b > 150 && g < 90,
    void: (r, g, b) => r < 110 && g < 40 && b < 60,
  };
  const ballIds = ["classic", "comet", "plasma", null, "void"];
  for (let i = 0; i < 5; i++) {
    const id = ballIds[i];
    if (!id) continue;
    const box = bboxOf(sheet, topCuts[i], 0, topCuts[i + 1], rowCut);
    const buf = cropRgba(sheet, box.x, box.y, box.w, box.h);
    let orb;
    if (orbTests[id]) {
      const o = findOrb(sheet, box, orbTests[id]);
      orb = { cx: o.cx - box.x, cy: o.cy - box.y, r: o.r };
    } else {
      orb = { cx: box.w / 2, cy: box.h / 2, r: Math.min(box.w, box.h) / 2 };
    }
    // 1x asset scale: orb diameter = 24px (drawn at 16px: downscaled, stays crisp)
    const s = 24 / (orb.r * 2);
    await emit(`ball-${id}`, "balls", id, buf, box.w, box.h, {
      w1x: Math.round(box.w * s),
      extra: { kind: "ball", orb: { x: round4(orb.cx / box.w), y: round4(orb.cy / box.h), r: round4(orb.r / box.w) } },
    });
  }
  // Ice orb comes from its own approved sheet.
  {
    const ice = await loadSheet("ball-ice.jpg");
    manifest.notes.iceFringe = round4(ice.fringe);
    const box = bboxOf(ice, 0, 0, ice.w, ice.h);
    const buf = cropRgba(ice, box.x, box.y, box.w, box.h);
    const r = Math.min(box.w, box.h) / 2;
    const s = 24 / (r * 2);
    await emit("ball-ice", "balls", "ice", buf, box.w, box.h, {
      w1x: Math.round(box.w * s),
      extra: { kind: "ball", orb: { x: 0.5, y: 0.5, r: round4(r / box.w) } },
    });
  }
  // Power-up gem tokens
  const puIds = ["grow", "multiball", "slowmo", "shield", "heart"];
  for (let i = 0; i < 5; i++) {
    const box = bboxOf(sheet, botCuts[i], rowCut, botCuts[i + 1], sheet.h);
    const buf = cropRgba(sheet, box.x, box.y, box.w, box.h);
    await emit(`powerup-${puIds[i]}`, "powerups", puIds[i], buf, box.w, box.h, {
      h1x: 52,
      extra: { kind: "powerup", anchor: { x: 0.5, y: 0.5 } },
    });
  }
}

// ---------------------------------------------------------------------------
// monsters
// ---------------------------------------------------------------------------

async function buildMonsters() {
  // The Coin Ghost is translucent lavender, so it needs a lower "solid" bar to
  // keep its body from being unmixed against the coins.
  const sheet = await loadSheet("monsters.jpg", { solidFar: 100 });
  manifest.notes.monstersFringe = round4(sheet.fringe);
  const names = ["ghost", "demon", "fairy", "blob"];
  const cuts = [0, 335, 655, 967, 1280];
  for (let i = 0; i < 4; i++) {
    const box = bboxOf(sheet, cuts[i], 0, cuts[i + 1], sheet.h);
    const buf = cropRgba(sheet, box.x, box.y, box.w, box.h);
    await emit(`monster-${names[i]}`, "monsters", names[i], buf, box.w, box.h, {
      h1x: 84,
      extra: { kind: "monster", anchor: { x: 0.5, y: 0.55 } },
    });
  }
}

// ---------------------------------------------------------------------------
// frame sheets (pets, vfx, shopkeeper busts)
// ---------------------------------------------------------------------------

/**
 * Slice a row of `count` frames, centroid-align them on one shared canvas so
 * the character does not jitter between frames, and keep the sheet's own
 * baseline so hops stay airborne.
 */
async function buildFrameRow(sheet, { prefix, dir, count, y0 = 0, y1 = sheet.h, nominal, win = 40, h1x, extra = {}, alignX = true, pad = 4 }) {
  const cuts = [0];
  for (let i = 1; i < count; i++) cuts.push(findCut(sheet, nominal[i], win, y0, y1));
  cuts.push(sheet.w);
  const cells = [];
  let uy0 = Infinity, uy1 = -1;
  for (let i = 0; i < count; i++) {
    const box = bboxOf(sheet, cuts[i], y0, cuts[i + 1], y1);
    let sum = 0, sx = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const a = sheet.rgba[(y * sheet.w + x) * 4 + 3];
        if (a > 40) { sum += a; sx += a * x; }
      }
    }
    cells.push({ box, cx: alignX ? sx / sum : box.x + box.w / 2, cut: [cuts[i], cuts[i + 1]] });
    uy0 = Math.min(uy0, box.y); uy1 = Math.max(uy1, box.y + box.h - 1);
  }
  let half = 0;
  for (const c of cells) half = Math.max(half, c.cx - c.box.x, c.box.x + c.box.w - c.cx);
  const cw = Math.ceil(half * 2) + pad * 2;
  const ch = uy1 - uy0 + 1 + pad * 2;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const c = cells[i];
    // Paste the cell's own columns only, so a neighbour's wing tip can't leak in.
    const buf = Buffer.alloc(cw * ch * 4);
    const ox = Math.round(cw / 2 - c.cx);
    for (let y = 0; y < ch; y++) {
      const sy = uy0 - pad + y;
      if (sy < 0 || sy >= sheet.h) continue;
      for (let x = c.cut[0]; x < c.cut[1]; x++) {
        const dx = x + ox;
        if (dx < 0 || dx >= cw) continue;
        const si = (sy * sheet.w + x) * 4;
        const di = (y * cw + dx) * 4;
        buf[di] = sheet.rgba[si]; buf[di + 1] = sheet.rgba[si + 1]; buf[di + 2] = sheet.rgba[si + 2]; buf[di + 3] = sheet.rgba[si + 3];
      }
    }
    frames.push(buf);
  }
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${i}`;
    await emit(id, dir, `${prefix}-${i}`, frames[i], cw, ch, { h1x, extra });
    ids.push(id);
  }
  return ids;
}

async function buildPets() {
  const defs = [
    { id: "turtle", file: "turtle-frames.jpg" },
    { id: "bat", file: "bat-frames.jpg" },
    { id: "dragon", file: "dragon-frames.jpg" },
  ];
  for (const d of defs) {
    // The turtle's time bubble is glass seen through magenta: make it translucent.
    const sheet = await loadSheet(d.file, d.id === "turtle" ? { sealedGlass: true, searchRadius: 70 } : {});
    manifest.notes[`${d.id}Fringe`] = round4(sheet.fringe);
    const nominal = [0, 213, 427, 640, 853, 1067];
    const ids = await buildFrameRow(sheet, {
      prefix: `pet-${d.id}`,
      dir: "pets",
      count: 6,
      nominal,
      win: 30,
      h1x: 96,
      extra: { kind: "pet", anchor: { x: 0.5, y: 0.96 } },
    });
    // frame roles: idle, blink, hop, windup, cast, cheer (bat: 0-2 are flap frames)
    manifest.animations[`pet-${d.id}`] = {
      frames: ids,
      roles: d.id === "bat"
        ? { idle: [0, 1, 2], blink: 3, hop: 2, windup: 0, cast: 4, cheer: 5 }
        : { idle: [0], blink: 1, hop: 2, windup: 3, cast: 4, cheer: 5 },
      fps: 12,
    };
  }
  // Procedural wing split for Batsy: columns outside [left,right] flap about the shoulder.
  manifest.animations["pet-bat"].wings = { left: 0.31, right: 0.69, shoulderY: 0.5 };
}

async function buildVfx() {
  const sheet = await loadSheet("vfx-frames.jpg");
  manifest.notes.vfxFringe = round4(sheet.fringe);
  const r1 = findRowCut(sheet, 245, 25);
  const r2 = findRowCut(sheet, 460, 25);
  const nominal = [0, 213, 427, 640, 853, 1067];
  const rows = [
    { prefix: "vfx-smear", y0: 0, y1: r1 },
    { prefix: "vfx-spark", y0: r1, y1: r2 },
    { prefix: "vfx-poof", y0: r2, y1: sheet.h },
  ];
  for (const row of rows) {
    const ids = await buildFrameRow(sheet, {
      prefix: row.prefix, dir: "vfx", count: 6, y0: row.y0, y1: row.y1, nominal, win: 40, h1x: 128, alignX: false,
      extra: { kind: "vfx", anchor: { x: 0.5, y: 0.5 } },
    });
    manifest.animations[row.prefix] = { frames: ids, fps: row.prefix === "vfx-smear" ? 30 : 24 };
  }
}

async function buildShopkeeper() {
  // Hair strands enclose slivers of magenta: drop sealed pockets that are key-tinted.
  const full = await loadSheet("shopkeeper.jpg", { pocketNear: 85, pocketMean: 75 });
  purgeMagenta(full.rgba, full.w, full.h);
  manifest.notes.shopkeeperFringe = round4(full.fringe);
  const box = bboxOf(full, 0, 0, full.w, full.h);
  await emit("shopkeeper-full", "shop", "keeper", cropRgba(full, box.x, box.y, box.w, box.h), box.w, box.h, {
    h1x: 420,
    extra: { kind: "portrait", anchor: { x: 0.5, y: 1 } },
  });
  const sheet = await loadSheet("shopkeeper-expressions.jpg", { pocketNear: 85, pocketMean: 75 });
  purgeMagenta(sheet.rgba, sheet.w, sheet.h);
  manifest.notes.bustsFringe = round4(sheet.fringe);
  const ids = await buildFrameRow(sheet, {
    prefix: "shopkeeper-bust", dir: "shop", count: 5, nominal: [0, 256, 512, 768, 1024], win: 30, h1x: 360, alignX: true,
    extra: { kind: "portrait", anchor: { x: 0.5, y: 1 } },
  });
  // smile, blink, excited (purchase), pout (can't afford), wink
  manifest.animations["shopkeeper-bust"] = {
    frames: ids,
    roles: { smile: 0, blink: 1, excited: 2, pout: 3, wink: 4 },
    fps: 12,
  };
}

// ---------------------------------------------------------------------------
// arenas + title (opaque art, no keying)
// ---------------------------------------------------------------------------

const ARENA_HD = {
  midnight: "stone-keep",
  synthwave: "enchanted",
  terminal: "gloom-cave",
  sunset: "lava-pit",
  deep: "abyss",
  shop: "shop",
};

function findHd(id) {
  const dir = path.join(SRC, "arenas-hd");
  const base = ARENA_HD[id];
  if (!base || !fs.existsSync(dir)) return null;
  for (const ext of ["png", "webp", "jpg", "jpeg"]) {
    const file = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(name, w) {
  let s = 2166136261;
  const str = `${name}:${w}`;
  for (let i = 0; i < str.length; i++) s = Math.imul(s ^ str.charCodeAt(i), 16777619);
  return s >>> 0;
}

/** Low-contrast monochrome noise. Overlay-blended, this reads as film grain, not speckle. */
async function filmGrain(w, h, seed, amp = 20) {
  const rnd = mulberry32(seed);
  const buf = Buffer.alloc(w * h * 4);
  const lo = 128 - Math.round(amp / 2);
  for (let i = 0; i < w * h; i++) {
    const n = lo + Math.floor(rnd() * amp);
    const o = i * 4;
    buf[o] = buf[o + 1] = buf[o + 2] = n;
    buf[o + 3] = 255;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/**
 * x (source px) of the faint vertical centre line painted into an HD plate, or
 * null when there isn't one. Thin-line detector: a column brighter than the
 * columns 4px either side, summed over the lower middle of the floor.
 */
async function detectCentreLine(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const lo = Math.round(w / 2 - 48), hi = Math.round(w / 2 + 48);
  const col = new Float64Array(w);
  for (let y = Math.floor(h * 0.45); y < Math.floor(h * 0.85); y++) {
    for (let x = lo - 6; x < hi + 6; x++) {
      const o = (y * w + x) * c;
      col[x] += data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11;
    }
  }
  const rows = Math.floor(h * 0.85) - Math.floor(h * 0.45);
  let best = -1, bestScore = 0, sum = 0, n = 0;
  for (let x = lo; x < hi; x++) {
    const score = (col[x] - (col[x - 4] + col[x + 4]) / 2) / rows;
    sum += Math.abs(score); n++;
    if (score > bestScore) { bestScore = score; best = x; }
  }
  // must stand clearly above the floor texture's own column noise
  return best >= 0 && bestScore > 4 && bestScore > (sum / n) * 3 ? best : null;
}

async function buildArenas() {
  const names = ["midnight", "synthwave", "terminal", "sunset", "deep", "shop"];
  const hdUsed = [];
  const CELL_W = 426, CELL_H = 360, INSET = 7;
  const sheet = path.join(SRC, "arenas-shop.jpg");
  fs.mkdirSync(path.join(OUT, "arenas"), { recursive: true });
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const isShop = name === "shop";
    const out1 = isShop ? [1280, 720] : [800, 500];
    const out2 = isShop ? null : [1600, 1000];
    const hd = findHd(name);
    if (hd) hdUsed.push(name);
    // Sheet cells are ~410px: a stronger unsharp plus grain hides the upscale.
    // The 1280x720 HD plates are not upscaled, so they get a light unsharp and a
    // barely-there grain (only to stop banding in the dark gradients).
    const sharpen = hd
      ? { sigma: 0.6, m1: 0.8, m2: 1.4 }
      : { sigma: 1.05, m1: 0.45, m2: 2.8 };
    const grainAmp = hd ? 5 : 20;
    // Cover-crop the plate to the court aspect, windowed so the painted centre
    // line lands on the true court centre (x = w/2) rather than on the crop's.
    let hdCrop = null;
    if (hd) {
      const meta = await sharp(hd).metadata();
      const aspect = out1[0] / out1[1];
      const cropW = Math.min(meta.width, Math.round(meta.height * aspect));
      const line = isShop ? null : await detectCentreLine(hd);
      const left = Math.max(0, Math.min(meta.width - cropW, Math.round((line ?? meta.width / 2) - cropW / 2)));
      hdCrop = { left, top: 0, width: cropW, height: meta.height };
      manifest.arenas[name] = {
        centreLineX: line == null ? null : Math.round(((line - left) / cropW) * out1[0] * 10) / 10,
      };
    }
    const source = async (dims) => {
      if (hd) {
        return sharp(hd).extract(hdCrop).resize(dims[0], dims[1], { kernel: "lanczos3", fit: "fill" });
      }
      const col = i % 3, row = (i / 3) | 0;
      const left = Math.round(col * (1280 / 3)) + INSET;
      const top = row * CELL_H + INSET;
      const w = CELL_W - INSET * 2, h = CELL_H - INSET * 2;
      const aspect = isShop ? 16 / 9 : 8 / 5;
      const cropH = Math.round(w / aspect);
      const slack = h - cropH;
      const cropTop = top + Math.round(slack * (isShop ? 0.1 : 0.22));
      return sharp(sheet).extract({ left, top: cropTop, width: w, height: cropH })
        .resize(dims[0], dims[1], { kernel: "lanczos3", fit: "fill" });
    };
    const write = async (dims, file) => {
      const grain = await filmGrain(dims[0], dims[1], seedOf(name, dims[0]), grainAmp);
      await (await source(dims))
        .sharpen(sharpen)
        .composite([{ input: grain, blend: "overlay" }])
        .webp(WEBP_BG)
        .toFile(path.join(OUT, file));
      written.push(file);
    };
    const f1 = `arenas/${name}.webp`;
    await write(out1, f1);
    if (out2) await write(out2, `arenas/${name}@2x.webp`);
    manifest.arenas[name] = { ...manifest.arenas[name], file: `arenas/${name}`, w: out1[0], h: out1[1], has2x: !isShop };
  }
  await sharp(path.join(SRC, "title.jpg")).webp({ quality: 82, effort: 6 }).toFile(path.join(OUT, "title.webp"));
  written.push("title.webp");
  manifest.notes.title = { file: "title", w: 1280, h: 720 };
  manifest.notes.arenaFinish = hdUsed.length === names.length ? "hd-unsharp" : "unsharp+grain";
  manifest.notes.arenaSource = hdUsed.length ? `arenas-hd: ${hdUsed.join(", ")}` : "arenas-shop.jpg slices";
}

// ---------------------------------------------------------------------------
// QA contact sheets
// ---------------------------------------------------------------------------

async function writeQa() {
  if (!QA) return;
  fs.mkdirSync(QA, { recursive: true });
  const groups = {
    weapons: Object.keys(manifest.sprites).filter((k) => k.startsWith("weapon-")),
    balls: Object.keys(manifest.sprites).filter((k) => k.startsWith("ball-") || k.startsWith("powerup-")),
    creatures: Object.keys(manifest.sprites).filter((k) => k.startsWith("monster-") || /^pet-.*-[0-5]$/.test(k)),
    vfx: Object.keys(manifest.sprites).filter((k) => k.startsWith("vfx-")),
    shop: Object.keys(manifest.sprites).filter((k) => k.startsWith("shopkeeper-")),
  };
  for (const [group, ids] of Object.entries(groups)) {
    for (const [tone, bg] of [["dark", "#15101f"], ["light", "#d8d8d8"]]) {
      // 2x asset at 1:1 => "2x zoom" relative to the 1x layout
      const tiles = [];
      let x = 12, y = 12, rowH = 0;
      const maxW = 1500;
      for (const id of ids) {
        const s = manifest.sprites[id];
        const img = await sharp(path.join(OUT, `${s.file}@2x.webp`)).png().toBuffer();
        if (x + s.w2 + 12 > maxW) { x = 12; y += rowH + 12; rowH = 0; }
        tiles.push({ input: img, left: x, top: y });
        x += s.w2 + 12;
        rowH = Math.max(rowH, s.h2);
      }
      const H = y + rowH + 12;
      await sharp({ create: { width: maxW, height: H, channels: 3, background: bg } })
        .composite(tiles)
        .png()
        .toFile(path.join(QA, `assets-${group}-${tone}.png`));
    }
  }
}

// ---------------------------------------------------------------------------

const ARENAS_ONLY = args.includes("--arenas-only");

function bundleBytes() {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const child = path.join(dir, e.name);
    return e.isDirectory() ? walk(child) : [child];
  });
  return walk(OUT).filter((f) => path.basename(f) !== "manifest.json");
}

async function main() {
  if (ARENAS_ONLY) {
    const prev = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
    for (const key of Object.keys(manifest)) delete manifest[key];
    Object.assign(manifest, prev);
    manifest.arenas = {};
  } else {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    await buildWeapons();
    await buildBalls();
    await buildMonsters();
    await buildPets();
    await buildVfx();
    await buildShopkeeper();
  }
  await buildArenas();

  const files = bundleBytes();
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  manifest.notes.totalBytes = bytes;
  manifest.notes.files = files.length;
  const sorted = JSON.parse(JSON.stringify(manifest, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)));
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(sorted, null, 1)}\n`);
  if (!ARENAS_ONLY) await writeQa();
  console.log(`pong assets: ${written.length} files, ${(bytes / 1024).toFixed(0)} KiB -> ${path.relative(repoRoot, OUT)}`);
  for (const [k, v] of Object.entries(manifest.notes)) if (k.endsWith("Fringe")) console.log(`  fringe ${k}: ${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
