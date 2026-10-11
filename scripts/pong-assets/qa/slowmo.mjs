#!/usr/bin/env node
// Slow-motion proof of the hit feel: several weapon hits (tip, sweet spot,
// angled, handle miss) captured at 1/240s game steps with the hit-zone debug
// overlay on, then encoded to WebM + GIF at 0.25x speed.
//
//   node scripts/pong-assets/qa/slowmo.mjs [--out <dir>] [--weapon classic|inferno|...]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const require = createRequire(path.join(repoRoot, "dashboard/package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(repoRoot, "../../screens/pong-anime")));
const WEAPON = arg("weapon", "classic");
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pong-slowmo-"));

const h = await startHarness();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(h.url);
await page.evaluate((w) => localStorage.setItem("konami-pong-v1", JSON.stringify({ equippedPaddle: w, equippedPet: "dragon", equippedCourt: "midnight", ownedPaddles: ["classic", w], ownedPets: ["turtle", "dragon"], ownedCourts: ["midnight"], upgrades: { startHp: 2 } })), WEAPON);
await page.reload();
await page.waitForFunction(() => window.__pongUi);
await page.getByRole("button", { name: /start run/i }).first().click();
await page.waitForFunction(() => window.__pongGame);
await page.evaluate(() => { const g = window.__pongGame; g.debugHold(); g.debugToggleOverlay(true); g.debugPlace(250); });

let n = 0;
const step = (k, dt) => page.evaluate(([k, dt]) => { for (let i = 0; i < k; i++) window.__pongGame.debugStep(dt); }, [k, dt]);

// (label, serve y offset from paddle top in px, ball speed, vy)
const shots = [
  ["tip", 6, 9, 0],
  ["sweet", 36, 12, 0],
  ["low-edge", 70, 14, 0],
  ["angled-sweet", 30, 10, -3],
  ["handle-miss", 118, 11, 0],
  ["sweet-fast", 40, 17, 0],
];
for (const [label, off, speed, vy] of shots) {
  await page.evaluate(() => window.__pongGame.debugPlace(250));
  await step(14, 1 / 60);
  const top = await page.evaluate(() => window.__pongGame.debugState().player.y);
  // serve from far enough that vy brings it onto the target height at contact
  // aim a drifting ball so it still arrives at the target height: serve x is 640, face ~38
  const travelFrames = (640 - 40) / speed;
  await page.evaluate(([y, s, v]) => window.__pongGame.debugServe(y, s, v), [top + off - vy * travelFrames, speed, vy]);
  // coast to ~0.2s before contact (or until the ball is close)
  for (let f = 0; f < 400; f++) {
    const s = await page.evaluate(() => { const g = window.__pongGame.debugState(); return { p: g.predicted, x: g.balls[0]?.x ?? 999 }; });
    if ((s.p && s.p.tau < 0.2) || s.x < 150) break;
    await step(1, 1 / 60);
  }
  // contacts[] keeps earlier hits, so a shot is "after contact" only once a new one lands.
  const seen = await page.evaluate(() => window.__pongGame.debugState().contacts.at(-1)?.t ?? -1);
  let after = 0;
  for (let f = 0; f < 90 && after < 14; f++) {
    const st = await page.evaluate((seen) => {
      window.__pongGame.debugStep(1 / 60);
      const src = document.querySelector("canvas");
      const w = 720;
      const h = Math.round((src.height * w) / src.width);
      let c = window.__pongCap;
      if (!c) c = window.__pongCap = document.createElement("canvas");
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      c.getContext("2d").drawImage(src, 0, 0, w, h);
      const s = window.__pongGame.debugState();
      const last = s.contacts.at(-1);
      return {
        jpg: c.toDataURL("image/jpeg", 0.62),
        fresh: last ? last.t > seen : false,
        x: s.balls[0]?.x ?? null,
        balls: s.balls.length,
      };
    }, seen);
    fs.writeFileSync(path.join(tmp, `f${String(n++).padStart(5, "0")}.jpg`), Buffer.from(st.jpg.split(",")[1], "base64"));
    if (st.fresh || (st.x !== null && st.x < 20) || !st.balls) after++;
  }
  console.log(label, "frames so far", n);
  // let the point resolve before the next serve
  await step(40, 1 / 60);
  // a stray return can cost hearts between shots: top them up by clearing the ball
  await page.evaluate(() => window.__pongGame.debugServe(250, 0.01, 0));
}
await browser.close();
await h.close();

const webm = path.join(OUT, `08-slowmo-hits-${WEAPON}.webm`);
const gif = path.join(OUT, `08-slowmo-hits-${WEAPON}.gif`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "20", "-i", path.join(tmp, "f%05d.jpg"), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-pix_fmt", "yuv420p", webm]);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "20", "-i", path.join(tmp, "f%05d.jpg"), "-vf", "fps=20,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", gif]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("wrote", webm, `(${(fs.statSync(webm).size / 1024).toFixed(0)} KiB)`);
console.log("wrote", gif, `(${(fs.statSync(gif).size / 1024).toFixed(0)} KiB)`);
if (errors.length) { console.log("page errors:", errors.join("\n")); process.exitCode = 1; }
