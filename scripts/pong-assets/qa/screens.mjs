#!/usr/bin/env node
// Screenshot pass for the reskin: menu, every arena in play, a hit, the shop,
// a draft and game over.
//
//   node scripts/pong-assets/qa/screens.mjs [--out <dir>] [--only menu,arenas,hit,shop,draft,over,ux] [--dpr 1|2] [--courts deep,sunset]
//
// Needs the playwright browsers already installed (dashboard/node_modules).

import fs from "node:fs";
import path from "node:path";
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
const ONLY = new Set((arg("only", "menu,arenas,hit,shop,draft,over,ux") ?? "").split(","));
const DPR = Number(arg("dpr", "1"));
const TAG = DPR === 2 ? "@2x" : "";
fs.mkdirSync(OUT, { recursive: true });

const h = await startHarness();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });

const shot = async (name) => {
  const file = path.join(OUT, `${name}${TAG}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  console.log("wrote", path.relative(process.cwd(), file));
};

async function boot(save = {}) {
  await page.goto(h.url);
  await page.evaluate((s) => {
    const base = { coins: 1250, ownedPaddles: ["classic", "neon", "inferno", "matrix", "royal", "gold"], ownedBalls: ["classic", "comet", "plasma", "ice", "void"], ownedCourts: ["midnight", "synthwave", "terminal", "sunset", "deep"], ownedPets: ["turtle", "bat", "dragon"], bestRound: 6, totalRuns: 14, totalCoins: 3920 };
    localStorage.setItem("konami-pong-v1", JSON.stringify({ ...base, ...s }));
  }, save);
  await page.reload();
  await page.waitForFunction(() => window.__pongUi);
}

async function startRun() {
  await page.evaluate(() => { window.__pongGame = undefined; });
  await page.getByRole("button", { name: /start run/i }).first().click();
  await page.waitForFunction(() => window.__pongGame);
  await page.evaluate(() => window.__pongGame.debugHold());
}

const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__pongGame.debugStep(dt); }, [n, dt]);

if (ONLY.has("menu")) {
  await boot();
  await page.waitForTimeout(400);
  await shot("01-menu");
}

if (ONLY.has("arenas")) {
  const courts = (arg("courts", "midnight,synthwave,terminal,sunset,deep") ?? "").split(",");
  const weapons = { midnight: "classic", synthwave: "neon", terminal: "inferno", sunset: "gold", deep: "royal" };
  const pets = { midnight: "turtle", synthwave: "bat", terminal: "dragon", sunset: "dragon", deep: "turtle" };
  const balls = { midnight: "classic", synthwave: "plasma", terminal: "ice", sunset: "comet", deep: "void" };
  for (const court of courts) {
    await boot({ equippedCourt: court, equippedPaddle: weapons[court], equippedPet: pets[court], equippedBall: balls[court] });
    await startRun();
    await page.evaluate(() => {
      const g = window.__pongGame;
      g.debugPlace(250);
      g.debugSpawn("powerup", "grow", 330, 150);
      g.debugSpawn("powerup", "shield", 480, 340);
      g.debugSpawn("creature", "ghost", 420, 220);
      g.debugSpawn("creature", "fairy", 300, 380);
      g.debugSpawn("creature", "demon", 560, 130);
      g.debugSpawn("creature", "blob", 620, 330);
    });
    await step(70);
    await page.evaluate(() => window.__pongGame.debugServe(150, 8, 3.5));
    await step(26);
    await shot(`02-arena-${court}`);
  }
}

if (ONLY.has("hit")) {
  await boot({ equippedPaddle: "classic", equippedBall: "classic" });
  await startRun();
  // sweet-spot hit on the iron sword, captured frame by frame around contact
  await page.evaluate(() => { const g = window.__pongGame; g.debugPlace(250); g.debugToggleOverlay(true); });
  await step(10);
  await page.evaluate(() => window.__pongGame.debugServe(246, 12, 0));
  let contactFrame = -1;
  for (let f = 0; f < 120 && contactFrame < 0; f++) {
    await step(1);
    const n = await page.evaluate(() => window.__pongGame.debugState().contacts.length);
    if (n > 0) contactFrame = f;
  }
  console.log("contact at frame", contactFrame);
  await shot("03-hit-contact-overlay");
  await page.evaluate(() => window.__pongGame.debugToggleOverlay(false));
  await step(2, 1 / 240);
  await shot("03-hit-impact");
  await step(5);
  await shot("03-hit-followthrough");
}

if (ONLY.has("shop")) {
  await boot({ coins: 640, equippedPet: "bat" });
  await page.evaluate(() => window.__pongUi.openShop());
  await page.waitForTimeout(500);
  await shot("04-shop-weapons");
  await page.evaluate(() => { window.__pongUi.shopTab("pets"); window.__pongUi.react("excited", "Thank you, hero! A pleasure doing business~", 5000); });
  await page.waitForTimeout(450);
  await shot("04-shop-pets-excited");
  await page.evaluate(() => { window.__pongUi.shopTab("upgrades"); window.__pongUi.react("pout", "Hmm, a little short on gold… win a few more rounds!", 5000); });
  await page.waitForTimeout(450);
  await shot("04-shop-upgrades-pout");
}

if (ONLY.has("draft")) {
  await boot({ equippedPet: "dragon" });
  await page.evaluate(() => window.__pongUi.openDraft());
  await page.waitForTimeout(700);
  await shot("05-draft");
}

if (ONLY.has("over")) {
  await boot({ equippedPet: "turtle" });
  await page.evaluate(() => window.__pongUi.openGameOver(7, 184));
  await page.waitForTimeout(400);
  await shot("06-gameover");
}

// UX pass: Enter starts, Esc pauses (it used to throw the run away), P and the pause
// button agree, 1-3 pick a relic.
if (ONLY.has("ux")) {
  const expect = (cond, what) => { if (!cond) problems.push(`ux check failed: ${what}`); else console.log("ok:", what); };
  await boot();
  await page.evaluate(() => { window.__pongGame = undefined; });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__pongGame);
  await page.evaluate(() => window.__pongGame.debugHold());
  await page.evaluate(() => window.__pongGame.debugServe(200, 8, 2));
  await step(20);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  expect(await page.getByRole("dialog", { name: "Paused" }).isVisible(), "Esc opens the pause menu mid-round");
  const ballAt = () => page.evaluate(() => JSON.stringify(window.__pongGame.debugState().balls));
  const frozen = await ballAt();
  await step(30);
  expect((await ballAt()) === frozen, "the simulation is frozen while paused");
  await shot("10-ux-pause");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(!(await page.getByRole("dialog", { name: "Paused" }).isVisible()), "second Esc resumes");
  await page.keyboard.press("p");
  await page.waitForTimeout(200);
  expect(await page.getByRole("dialog", { name: "Paused" }).isVisible(), "P pauses");
  await page.getByRole("button", { name: "Quit run" }).click();
  await page.waitForTimeout(200);
  expect(await page.getByRole("button", { name: /start run/i }).first().isVisible(), "Quit run lands on the menu");

  await page.evaluate(() => window.__pongUi.openDraft());
  await page.waitForTimeout(600);
  await page.keyboard.press("2");
  await page.waitForFunction(() => window.__pongGame);
  await page.waitForTimeout(300);
  expect(await page.getByText("ROUND 02").first().isVisible(), "pressing 2 in the draft picks the middle relic and starts round 2");
  await page.waitForTimeout(600);
  await shot("10-ux-hud-after-draft");
}

await browser.close();
await h.close();
if (problems.length) {
  console.log("\nproblems:\n" + [...new Set(problems)].join("\n"));
  process.exitCode = 1;
}
