#!/usr/bin/env node
// Coin audit: crops every place the gold coin appears (menu stat, HUD, tavern
// header, tavern prices, draft footer, game over, the canvas coin pop) at 2x and
// measures how far the coin's vertical centre sits from the digits' cap-height
// centre, so "sits well" is a number and not an impression.
//
//   node scripts/pong-assets/qa/coins.mjs [--out <dir>] [--tag before|after]
//
// Writes 12-coin-<tag>-<place>.png and prints the offset in CSS px per place
// (0 = centred on the digits, negative = coin sits high).

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
const TAG = arg("tag", "after");
fs.mkdirSync(OUT, { recursive: true });

const h = await startHarness();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

async function boot(save = {}) {
  await page.goto(h.url);
  await page.evaluate((s) => {
    const base = { coins: 1250, ownedPaddles: ["classic"], ownedBalls: ["classic"], ownedCourts: ["midnight"], ownedPets: ["turtle"], bestRound: 6, totalRuns: 14, totalCoins: 3920 };
    localStorage.setItem("konami-pong-v1", JSON.stringify({ ...base, ...s }));
  }, save);
  await page.reload();
  await page.waitForFunction(() => window.__pongUi);
}

// Finds the coin <svg>/<span> inside `selector` and the text node's glyph box,
// returns both vertical centres in CSS px. The glyph box is the digits' ink
// extent measured from a 2x raster of the row, so it is cap-height, not line box.
async function measure(name, selector, { pad = 6 } = {}) {
  const row = page.locator(selector).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (!box) { problems.push(`${name}: no box for ${selector}`); return; }
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  const png = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, `12-coin-${TAG}-${name}.png`), png);

  const coin = await row.evaluate((el) => {
    const c = el.querySelector(".kp-coin, svg");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, fontSize: parseFloat(getComputedStyle(el).fontSize) };
  });
  if (!coin) { problems.push(`${name}: no coin in ${selector}`); return; }

  // ink extent of the digits: diff a shot with the coin hidden against one with the
  // text also made transparent, so it works on any button/background colour.
  const region = { x: coin.right + 1, y: clip.y, width: Math.max(4, box.x + box.width - coin.right + pad), height: clip.height };
  await row.evaluate((el) => { el.querySelectorAll(".kp-coin, svg").forEach((c) => { c.style.visibility = "hidden"; }); });
  const withText = await page.screenshot({ clip: region });
  await row.evaluate((el) => { el.style.setProperty("color", "transparent", "important"); el.style.setProperty("text-shadow", "none", "important"); el.querySelectorAll("*").forEach((c) => { c.style.setProperty("color", "transparent", "important"); c.style.setProperty("text-shadow", "none", "important"); }); });
  const noText = await page.screenshot({ clip: region });
  await page.evaluate(() => {}); // state is rebuilt per place, no need to restore
  const A = await sharp(withText).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(noText).raw().toBuffer({ resolveWithObject: true });
  const info = A.info;
  let top = -1; let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    let hit = false;
    for (let x = 0; x < info.width && !hit; x++) {
      const i = (y * info.width + x) * info.channels;
      if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 90) hit = true;
    }
    if (hit) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) { console.log(`${name}: no digit ink found`); return; }
  const textMid = clip.y + (top + bottom + 1) / 2 / 2;
  const coinMid = (coin.top + coin.bottom) / 2;
  const size = coin.bottom - coin.top;
  console.log(`${name.padEnd(18)} coin ${size.toFixed(1)}px = ${(size / coin.fontSize).toFixed(2)}em  offset ${(coinMid - textMid).toFixed(2)}px (negative = coin high)`);
}

// menu: the Gold stat
await boot();
await page.waitForTimeout(300);
await measure("menu-stat", ".kp-stat:has-text('Gold') .kp-gold");

// tavern: header + prices on each tab
await boot({ coins: 640 });
await page.evaluate(() => window.__pongUi.openShop());
await page.waitForTimeout(500);
await measure("shop-header", ".kp-shop-head .kp-gold");
await measure("shop-price", ".kp-price");
await page.evaluate(() => window.__pongUi.shopTab("upgrades"));
await page.waitForTimeout(250);
await measure("shop-upgrade-price", ".kp-price");

// draft footer
await boot({ equippedPet: "dragon" });
await page.evaluate(() => window.__pongUi.openDraft());
await page.waitForTimeout(600);
await measure("draft-earned", ".kp-draft .kp-gold");

// game over
await boot();
await page.evaluate(() => window.__pongUi.openGameOver(7, 184));
await page.waitForTimeout(400);
await measure("gameover-stat", ".kp-over .kp-stat:has-text('Gold') .kp-gold");

// HUD in play
await boot();
await page.evaluate(() => { window.__pongGame = undefined; });
await page.getByRole("button", { name: /start run/i }).first().click();
await page.waitForFunction(() => window.__pongGame);
await page.evaluate(() => window.__pongGame.debugHold());
await page.waitForTimeout(400);
await measure("hud", ".kp-hud .kp-gold");

await browser.close();
await h.close();
if (problems.length) { console.log("problems:\n" + [...new Set(problems)].join("\n")); process.exitCode = 1; }
