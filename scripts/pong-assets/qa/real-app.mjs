#!/usr/bin/env node
// Real-app pass: boots the checkout's dashboard with `next dev` on a spare
// port (never :1337, the packaged app), opens Pong Quest with the Konami code,
// plays a round and screenshots it. The server is stopped by process group at
// the end; nothing is matched by name.
//
//   node scripts/pong-assets/qa/real-app.mjs [--port 1342] [--out <dir>]

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dashboard = path.join(repoRoot, "dashboard");
const require = createRequire(path.join(dashboard, "package.json"));
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg("port", "1342"));
const OUT = path.resolve(arg("out", path.join(repoRoot, "../../screens/pong-anime")));
if (PORT === 1337) throw new Error("refusing to touch the packaged app's port");
fs.mkdirSync(OUT, { recursive: true });

function listening(port) {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim().length > 0;
  } catch { return false; }
}
if (listening(PORT)) throw new Error(`port ${PORT} is already in use`);

const server = spawn("npx", ["tsx", "scripts/run-next-with-env.ts", "dev", "--port", String(PORT), "--hostname", "127.0.0.1"], {
  cwd: dashboard,
  env: { ...process.env, PORT: String(PORT), DEVHUB_SCHEDULER: "0", DEVHUB_DIST_DIR: ".next-pong-qa" },
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d; });
server.stderr.on("data", (d) => { log += d; });

function stopServer() {
  if (server.exitCode !== null || !server.pid) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
}
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

const base = `http://127.0.0.1:${PORT}`;
let ok = false;
for (let i = 0; i < 120 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try { ok = (await fetch(base, { redirect: "manual" })).status < 500; } catch { /* still starting */ }
}
if (!ok) { console.error(log.slice(-2000)); stopServer(); throw new Error("dev server did not come up"); }

const browser = await chromium.launch();
const problems = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  // exposes the game's debug hooks so a hit can be framed deterministically; no behaviour change
  await page.addInitScript(() => { window.__PONG_HARNESS__ = true; });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await page.waitForTimeout(4000);
  for (const k of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(60);
  }
  const start = page.getByRole("button", { name: /start run/i }).first();
  await start.waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "09-real-app-menu.png") });
  console.log("wrote 09-real-app-menu.png");

  await start.click();
  await page.waitForFunction(() => window.__pongGame, null, { timeout: 30000 });
  // let the live loop run: the paddle follows the mouse while the ball is served
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(640, 400 + 60 * Math.sin(i / 3)); // mid-court
    await page.waitForTimeout(100);
  }
  const step = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__pongGame.debugStep(dt); }, [n, dt]);
  // Frame the play shot: weapon mid-court, ball coming in low. The familiar rests in the
  // margin beside the court, level with the weapon.
  await page.evaluate(() => { const g = window.__pongGame; g.debugHold(); g.debugPlace(300); });
  await step(40);
  await page.evaluate(() => window.__pongGame.debugServe(400, 7, 0));
  await step(36);
  await page.screenshot({ path: path.join(OUT, "09-real-app-play.png") });
  console.log("wrote 09-real-app-play.png");

  async function hit(name, y, serveY, vy) {
    await page.evaluate(([y]) => { const g = window.__pongGame; g.debugHold(); g.debugPlace(y); }, [y]);
    await step(40);
    await page.evaluate(([sy, v]) => window.__pongGame.debugServe(sy, 12, v), [serveY, vy]);
    let contacted = false;
    for (let f = 0; f < 160 && !contacted; f++) {
      await step(1);
      contacted = await page.evaluate(() => window.__pongGame.debugState().contacts.length > 0 && window.__pongGame.debugState().hitStop > 0);
    }
    await step(2, 1 / 240);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`wrote ${name}.png (contact: ${contacted})`);
  }
  await hit("09-real-app-hit", 250, 246, 0);
  // paddle against the top wall: the familiar follows it up the rail
  await page.evaluate(() => { const g = window.__pongGame; g.debugHold(); g.debugPlace(60); });
  await step(40);
  await page.screenshot({ path: path.join(OUT, "09-real-app-pet-top.png") });
  console.log("wrote 09-real-app-pet-top.png");
  // the ability: the familiar dashes to the frame edge and fires into the court
  await page.evaluate(() => { const g = window.__pongGame; g.debugHold(); g.debugPlace(300); g.debugServe(420, 6, 0); });
  await step(40);
  await page.mouse.click(640, 400);
  await step(7);
  await page.screenshot({ path: path.join(OUT, "09-real-app-cast.png") });
  console.log("wrote 09-real-app-cast.png");
  // a narrow window, where the margin has the least room
  await page.setViewportSize({ width: 760, height: 720 });
  await page.waitForTimeout(600);
  await step(30);
  await page.screenshot({ path: path.join(OUT, "09-real-app-narrow.png") });
  console.log("wrote 09-real-app-narrow.png");
} finally {
  await browser.close();
  stopServer();
}
await new Promise((r) => setTimeout(r, 3000));
console.log(listening(PORT) ? `WARNING: port ${PORT} still listening` : `port ${PORT} released`);
if (problems.length) console.log("page errors:", [...new Set(problems)].join("\n"));
