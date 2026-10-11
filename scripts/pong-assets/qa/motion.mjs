#!/usr/bin/env node
// Frame-sequence contact sheets for the animations that are hard to judge from
// a single screenshot: a sweet-spot hit, a whiff, a monster poof, a power-up
// burst and the pet's ability.
//
//   node scripts/pong-assets/qa/motion.mjs [--out <dir>] [--only hit,whiff,monster,powerup,pet]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const require = createRequire(path.join(repoRoot, "dashboard/package.json"));
const { chromium } = require("playwright");
const sharp = require("sharp");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(arg("out", path.join(repoRoot, "../../screens/pong-anime")));
const ONLY = new Set((arg("only", "hit,whiff,monster,powerup,pet") ?? "").split(","));
fs.mkdirSync(OUT, { recursive: true });

const h = await startHarness();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));

async function boot(save = {}) {
  await page.goto(h.url);
  await page.evaluate((s) => {
    localStorage.setItem("konami-pong-v1", JSON.stringify({ coins: 900, ownedPaddles: ["classic", "neon", "inferno", "matrix", "royal", "gold"], ownedBalls: ["classic", "comet", "plasma", "ice", "void"], ownedCourts: ["midnight", "synthwave", "terminal", "sunset", "deep"], ownedPets: ["turtle", "bat", "dragon"], ...s }));
  }, save);
  await page.reload();
  await page.waitForFunction(() => window.__pongUi);
  await page.evaluate(() => { window.__pongGame = undefined; });
  await page.getByRole("button", { name: /start run/i }).first().click();
  await page.waitForFunction(() => window.__pongGame);
  await page.evaluate(() => window.__pongGame.debugHold());
}

const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__pongGame.debugStep(dt); }, [n, dt]);

/** World-space rectangle -> page clip. */
async function clipFor(x, y, w, hh) {
  const box = await page.locator(".kp-frame canvas").boundingBox();
  const view = await page.evaluate(() => window.__pongGame.debugView());
  const k = box.width / view.viewW;
  const left = box.x + (x + view.bleedX) * k;
  const top = box.y + (y + view.bleedY) * k;
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: w * k,
    height: hh * k,
  };
}

async function sheet(name, frames, cols = 6) {
  const metas = await Promise.all(frames.map((f) => sharp(f).metadata()));
  const w = Math.max(...metas.map((m) => m.width));
  const hh = Math.max(...metas.map((m) => m.height));
  const rows = Math.ceil(frames.length / cols);
  const gap = 6;
  const tiles = frames.map((input, i) => ({ input, left: (i % cols) * (w + gap), top: Math.floor(i / cols) * (hh + gap) }));
  const file = path.join(OUT, `${name}.png`);
  await sharp({ create: { width: cols * (w + gap), height: rows * (hh + gap), channels: 3, background: "#000" } }).composite(tiles).png().toFile(file);
  console.log("wrote", path.relative(process.cwd(), file));
}

async function capture(name, region, dts, cols = 6) {
  const clip = await clipFor(...region);
  const frames = [];
  for (const dt of dts) {
    if (dt > 0) await step(1, dt);
    const buf = await page.screenshot({ clip });
    frames.push(await sharp(buf).resize({ width: Math.round(clip.width * 1.6), kernel: "lanczos3" }).png().toBuffer());
  }
  await sheet(name, frames, cols);
}

if (ONLY.has("hit")) {
  await boot({ equippedPaddle: "classic" });
  await page.evaluate(() => { window.__pongGame.debugPlace(250); });
  await step(8);
  await page.evaluate(() => window.__pongGame.debugServe(236, 12));
  // run to the frame before contact
  for (let f = 0; f < 200; f++) {
    const near = await page.evaluate(() => { const s = window.__pongGame.debugState(); return s.predicted && s.predicted.tau < 0.07; });
    if (near) break;
    await step(1);
  }
  const dts = [0, 1 / 120, 1 / 120, 1 / 120, 1 / 120, 1 / 120, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60, 1 / 60];
  await capture("07-motion-sweet-hit", [-170, 40, 460, 400], dts, 6);
}

if (ONLY.has("whiff")) {
  await boot({ equippedPaddle: "inferno" });
  await page.evaluate(() => { window.__pongGame.debugPlace(150); });
  await step(8);
  await page.evaluate(() => window.__pongGame.debugServe(236, 11));
  for (let f = 0; f < 200; f++) {
    const x = await page.evaluate(() => window.__pongGame.debugState().balls[0]?.x ?? 999);
    if (x < 120) break;
    await step(1);
  }
  await capture("07-motion-whiff", [-150, 10, 380, 360], Array(14).fill(1 / 60), 7);
}

if (ONLY.has("monster")) {
  await boot({ equippedPaddle: "gold" });
  await page.evaluate(() => {
    const g = window.__pongGame;
    g.debugPlace(250);
    g.debugSpawn("creature", "ghost", 300, 250);
    g.debugServe(250, 7);
  });
  for (let f = 0; f < 200; f++) {
    await step(1);
    const alive = await page.evaluate(() => window.__pongGame.debugState().balls[0]?.x ?? 0);
    if (alive < 330) break;
  }
  await capture("07-motion-monster-poof", [200, 190, 130, 320], Array(12).fill(1 / 48), 6);
}

if (ONLY.has("powerup")) {
  await boot({ equippedPaddle: "royal", equippedCourt: "synthwave" });
  await page.evaluate(() => {
    const g = window.__pongGame;
    g.debugPlace(250);
    g.debugSpawn("powerup", "heart", 300, 250);
    g.debugServe(250, 7);
  });
  for (let f = 0; f < 200; f++) {
    await step(1);
    const x = await page.evaluate(() => window.__pongGame.debugState().balls[0]?.x ?? 0);
    if (x < 330) break;
  }
  await capture("07-motion-powerup-burst", [190, 190, 130, 320], Array(12).fill(1 / 48), 6);
}

if (ONLY.has("pet")) {
  for (const pet of ["turtle", "bat", "dragon"]) {
    await boot({ equippedPet: pet, equippedPaddle: "classic" });
    await page.evaluate(() => window.__pongGame.debugPlace(240));
    await step(10);
    // the rail is part of the shot: the familiar lives left of the court
    await page.mouse.click(640, 400);
    await capture(`07-motion-pet-${pet}`, [-185, 10, 520, 400], Array(12).fill(1 / 24), 6);

    // never over the court, and the shot lands inside the 0.4 s budget
    await boot({ equippedPet: pet, equippedPaddle: "classic" });
    await page.evaluate(() => window.__pongGame.debugPlace(300));
    await step(30);
    await page.mouse.click(640, 400);
    let maxRight = -Infinity;
    let landedAt = null;
    for (let f = 0; f < 60; f++) {
      await step(1);
      const s = await page.evaluate(() => { const g = window.__pongGame.debugState(); return { pet: g.pet, balls: g.balls.length }; });
      maxRight = Math.max(maxRight, s.pet.x + s.pet.w / 2);
      if (landedAt === null && s.pet.castT >= 0.24) landedAt = s.pet.castT;
    }
    console.log(`${pet}: rightmost pet edge ${maxRight.toFixed(1)} (court edge is 0), effect lands at ${landedAt?.toFixed(3)} s`);
    if (!(maxRight < 0) || landedAt === null || landedAt > 0.4) { console.log("FAIL: pet crossed into the court or the cast was late"); process.exitCode = 1; }
  }
  // paddle against the top wall: the familiar follows it up the rail
  await boot({ equippedPet: "bat", equippedPaddle: "classic" });
  await page.evaluate(() => window.__pongGame.debugPlace(40));
  await step(60);
  await capture("07-motion-pet-bat-top", [-185, 0, 520, 380], Array(6).fill(1 / 24), 6);
}

await browser.close();
await h.close();
if (problems.length) { console.log("page errors:", [...new Set(problems)].join("\n")); process.exitCode = 1; }
