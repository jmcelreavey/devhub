#!/usr/bin/env node
// Narrow-window capture: every familiar at a tablet-ish width, resting and
// mid-cast, so the pet's home (the margin beside the court) can be judged
// where there is the least room for it.
//
//   node scripts/pong-assets/qa/narrow.mjs [--out <dir>] [--width 760] [--height 720] [--tag after]
//
// Writes 11-narrow-<tag>-<pet>.png (resting) and 11-narrow-<tag>-<pet>-cast.png
// (four frames of the ability, first 0.4s, 0.1s apart, left half of the window).

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
const WIDTH = Number(arg("width", "760"));
const HEIGHT = Number(arg("height", "720"));
const TAG = arg("tag", "after");
fs.mkdirSync(OUT, { recursive: true });

const h = await startHarness();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));

async function boot(pet) {
  await page.goto(h.url);
  await page.evaluate((p) => {
    localStorage.setItem("konami-pong-v1", JSON.stringify({ coins: 900, equippedPet: p, equippedPaddle: "classic", ownedPaddles: ["classic"], ownedPets: ["turtle", "bat", "dragon"], ownedCourts: ["midnight"] }));
  }, pet);
  await page.reload();
  await page.waitForFunction(() => window.__pongUi);
  await page.evaluate(() => { window.__pongGame = undefined; });
  await page.getByRole("button", { name: /start run/i }).first().click();
  await page.waitForFunction(() => window.__pongGame);
  await page.evaluate(() => window.__pongGame.debugHold());
}
const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__pongGame.debugStep(dt); }, [n, dt]);

for (const pet of ["turtle", "bat", "dragon"]) {
  await boot(pet);
  await page.evaluate(() => window.__pongGame.debugPlace(230));
  await step(90);
  await page.evaluate(() => window.__pongGame.debugServe(380, 7, 0));
  await step(30);
  await page.screenshot({ path: path.join(OUT, `11-narrow-${TAG}-${pet}.png`) });
  console.log("wrote", `11-narrow-${TAG}-${pet}.png`);

  await page.mouse.click(Math.round(WIDTH / 2), Math.round(HEIGHT / 2));
  const frames = [];
  const box = await page.locator(".kp-frame").boundingBox();
  const clip = { x: Math.max(0, box.x - 150), y: Math.max(0, box.y - 10), width: Math.min(WIDTH, box.width * 0.55 + 150), height: box.height + 20 };
  for (let i = 0; i < 4; i++) {
    frames.push(await sharp(await page.screenshot({ clip })).png().toBuffer());
    await step(6);
  }
  const w = Math.round(clip.width);
  const hh = Math.round(clip.height);
  await sharp({ create: { width: w * 2 + 6, height: hh * 2 + 6, channels: 3, background: "#000" } })
    .composite(frames.map((input, i) => ({ input, left: (i % 2) * (w + 6), top: Math.floor(i / 2) * (hh + 6) })))
    .png().toFile(path.join(OUT, `11-narrow-${TAG}-${pet}-cast.png`));
  console.log("wrote", `11-narrow-${TAG}-${pet}-cast.png`);
}

await browser.close();
await h.close();
if (problems.length) { console.log("page errors:", [...new Set(problems)].join("\n")); process.exitCode = 1; }
