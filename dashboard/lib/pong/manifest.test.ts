import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BALL_SKINS,
  COURT_SKINS,
  CREATURE_META,
  PADDLE_SKINS,
  PETS,
  POWERUP_TYPES,
} from "./data";
import { MANIFEST, manifestFiles } from "./manifest";

const PUBLIC = path.resolve(__dirname, "../../public/pong");
const BUDGET_BYTES = 6 * 1024 * 1024;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe("pong asset manifest", () => {
  it("lists only files that exist", () => {
    const missing = manifestFiles().filter((f) => !fs.existsSync(path.join(PUBLIC, f)));
    expect(missing).toEqual([]);
  });

  it("ships no concept sheets and stays under the size budget", () => {
    const files = walk(PUBLIC);
    expect(files.filter((f) => /\.(jpe?g|png)$/i.test(f))).toEqual([]);
    const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
    expect(bytes).toBeLessThan(BUDGET_BYTES);
  });

  it("arena plates keep their centre line on the true court centre", () => {
    const lines = Object.entries(MANIFEST.arenas).filter(([, a]) => typeof a.centreLineX === "number");
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const [id, a] of lines) expect(Math.abs((a.centreLineX as number) - a.w / 2), id).toBeLessThanOrEqual(1);
    // the shop interior has no centre line by design
    expect(MANIFEST.arenas.shop.centreLineX ?? null).toBeNull();
  });

  it("covers every skin, pet, power-up and creature by id", () => {
    for (const id of Object.keys(PADDLE_SKINS)) {
      const def = MANIFEST.weapons[id];
      expect(def, `weapon ${id}`).toBeDefined();
      expect(MANIFEST.sprites[def.sprite]).toBeDefined();
    }
    for (const id of Object.keys(BALL_SKINS)) {
      const s = MANIFEST.sprites[`ball-${id}`];
      expect(s, `ball ${id}`).toBeDefined();
      expect(s.orb?.r ?? 0).toBeGreaterThan(0);
    }
    for (const id of Object.keys(COURT_SKINS)) expect(MANIFEST.arenas[id], `arena ${id}`).toBeDefined();
    expect(MANIFEST.arenas.shop).toBeDefined();
    for (const id of Object.keys(PETS)) expect(MANIFEST.animations[`pet-${id}`], `pet ${id}`).toBeDefined();
    for (const t of POWERUP_TYPES) expect(MANIFEST.sprites[`powerup-${t}`], `powerup ${t}`).toBeDefined();
    for (const t of Object.keys(CREATURE_META)) expect(MANIFEST.sprites[`monster-${t}`], `monster ${t}`).toBeDefined();
  });

  it("has well-formed sprites, frames and hit zones", () => {
    for (const [id, s] of Object.entries(MANIFEST.sprites)) {
      expect(s.w, id).toBeGreaterThan(0);
      expect(s.h, id).toBeGreaterThan(0);
      expect(s.w2, id).toBeGreaterThanOrEqual(s.w);
      expect(s.h2, id).toBeGreaterThanOrEqual(s.h);
    }
    for (const [id, a] of Object.entries(MANIFEST.animations)) {
      expect(a.frames.length, id).toBeGreaterThan(0);
      for (const f of a.frames) expect(MANIFEST.sprites[f], `${id}:${f}`).toBeDefined();
      for (const v of Object.values(a.roles ?? {})) {
        for (const idx of Array.isArray(v) ? v : [v]) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(a.frames.length);
        }
      }
    }
    for (const [id, w] of Object.entries(MANIFEST.weapons)) {
      expect(w.polys.length, id).toBeGreaterThanOrEqual(3);
      expect(w.sweet.half).toBeGreaterThan(0);
      for (const poly of w.polys) {
        expect(poly.length).toBeGreaterThanOrEqual(3);
        for (const [u, v] of poly) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(1);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keys cleanly: no pink halo on any sheet", () => {
    for (const [k, v] of Object.entries(MANIFEST.notes)) {
      if (k.endsWith("Fringe")) expect(v as number, k).toBeLessThan(0.03);
    }
  });
});
