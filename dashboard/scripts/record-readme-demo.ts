#!/usr/bin/env tsx
/**
 * Records the README demo GIF by driving the real dashboard.
 *
 * Run it through `npm run demos:record` (scripts/demos/record.sh), which builds the
 * disposable fixture and starts the dashboard against it. Never point DEMO_URL at a
 * dashboard you use: the walk adds and completes tasks and syncs persona into $HOME.
 *
 * Capture is a CDP screencast rather than Playwright's video recorder, so the frames can
 * be encoded with sharp — no ffmpeg. The screencast only emits a frame when the page
 * paints, so frames are resampled onto a fixed clock to get per-frame GIF delays.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

const BASE_URL = requiredEnv("DEMO_URL");
const OUT = requiredEnv("DEMO_OUT");
const FRAMES_DIR = requiredEnv("DEMO_FRAMES_DIR");

const VIEWPORT = { width: 1280, height: 800 };
/** GitHub renders README images at most ~1000px wide; capturing larger only costs bytes. */
const GIF_SIZE = { width: 1024, height: 640 };
const FPS = 10;
const MAX_HOLD_MS = 3000;

interface Frame {
  png: Buffer;
  at: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${name} is not set — run this through npm run demos:record\n`);
    process.exit(1);
  }
  return value;
}

/** Fake cursor and caption: headless screencasts show neither, and a silent GIF needs both. */
const OVERLAY_SCRIPT = `
(() => {
  const mount = () => {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = [
      "nextjs-portal{display:none!important}",
      "#demo-cursor{position:fixed;z-index:2147483647;left:0;top:0;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.5);pointer-events:none;transition:transform .12s}",
      "#demo-cursor.down{transform:scale(.65)}",
      "#demo-caption{position:fixed;z-index:2147483646;left:256px;bottom:24px;padding:10px 18px;border-radius:999px;background:rgba(10,10,10,.88);color:#fff;font:600 17px/1.3 ui-sans-serif,system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap}",
      "#demo-caption:empty{display:none}",
    ].join("");
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    const saved = JSON.parse(sessionStorage.getItem("demo-cursor") || '{"x":640,"y":400}');
    cursor.style.left = saved.x + "px";
    cursor.style.top = saved.y + "px";
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    caption.textContent = sessionStorage.getItem("demo-caption") || "";
    document.body.append(cursor, caption);
    addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
      sessionStorage.setItem("demo-cursor", JSON.stringify({ x: e.clientX, y: e.clientY }));
    }, true);
    addEventListener("mousedown", () => cursor.classList.add("down"), true);
    addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  };
  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount);
})();
`;

async function setCaption(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    sessionStorage.setItem("demo-caption", value);
    const el = document.getElementById("demo-caption");
    if (el) el.textContent = value;
  }, text);
}

/** Glide the fake cursor to an element, then click it. */
async function clickOn(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`No bounding box for ${target}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled({ timeout: 90_000 });
  await page.waitForFunction(() => document.readyState === "complete");
}

function sidebarLink(page: Page, name: string): Locator {
  return page.locator("aside nav").getByRole("link", { name, exact: true }).first();
}

async function startScreencast(page: Page): Promise<() => Promise<{ frames: Frame[]; stoppedAt: number }>> {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on("Page.screencastFrame", (event) => {
    frames.push({ png: Buffer.from(event.data, "base64"), at: event.metadata.timestamp ?? Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "png",
    maxWidth: GIF_SIZE.width,
    maxHeight: GIF_SIZE.height,
    everyNthFrame: 1,
  });
  return async () => {
    await cdp.send("Page.stopScreencast");
    const stoppedAt = Date.now() / 1000;
    await cdp.detach();
    return { frames, stoppedAt };
  };
}

async function encodeGif(frames: Frame[], stoppedAt: number): Promise<number> {
  if (frames.length === 0) throw new Error("Screencast captured no frames");
  const stepMs = 1000 / FPS;
  const picked: { png: Buffer; delayMs: number; hash: string }[] = [];
  let index = 0;
  for (let t = frames[0].at; t < stoppedAt; t += stepMs / 1000) {
    while (index + 1 < frames.length && frames[index + 1].at <= t) index++;
    const hash = createHash("sha1").update(frames[index].png).digest("hex");
    const last = picked.at(-1);
    // Cap how long one unchanged frame holds, so waits on the server read as a beat, not dead air.
    if (last?.hash === hash) last.delayMs = Math.min(last.delayMs + stepMs, MAX_HOLD_MS);
    else picked.push({ png: frames[index].png, delayMs: stepMs, hash });
  }

  // Every frame of an animated join must share one size.
  const sized = await Promise.all(
    picked.map((p) => sharp(p.png).resize(GIF_SIZE.width, GIF_SIZE.height, { fit: "fill" }).png().toBuffer()),
  );
  await sharp(sized, { join: { animated: true }, limitInputPixels: false })
    .gif({
      delay: picked.map((p) => Math.round(p.delayMs)),
      loop: 0,
      effort: 8,
      dither: 0,
      interFrameMaxError: 4,
    })
    .toFile(OUT);
  return picked.length;
}

async function keyFrame(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(FRAMES_DIR, `${name}.png`) });
}

async function walk(page: Page): Promise<void> {
  // 1. Today (its caption is set before capture starts, so the GIF's first frame has one)
  await page.waitForTimeout(1800);
  const addTask = page.getByPlaceholder(/Add a task/);
  await clickOn(page, addTask);
  await addTask.pressSequentially("Write a regression test for webhook retries", { delay: 35 });
  await page.keyboard.press("Enter");
  await expect(page.getByText("Write a regression test for webhook retries").first()).toBeVisible();
  await page.waitForTimeout(700);
  const pinNode = page.locator(".task-row").filter({ hasText: "Pin Node 22 in the deploy image" });
  await clickOn(page, pinNode.getByRole("button", { name: "Mark task complete" }));
  await page.waitForTimeout(1600);
  await keyFrame(page, "1-today");

  // 2. A note
  await setCaption(page, "Notes and learnings are plain files, versioned in git");
  await clickOn(page, sidebarLink(page, "Notes"));
  const retro = page.getByText("Checkout retro", { exact: true }).first();
  if (!(await retro.isVisible().catch(() => false))) {
    await clickOn(page, page.getByText(/^meetings$/i).first());
  }
  await clickOn(page, retro);
  await expect(page.getByText("Retry storm on the payments webhook").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2600);
  await keyFrame(page, "2-note");

  // 3. Persona sync
  await setCaption(page, "One set of engineering standards, synced into every AI tool");
  await clickOn(page, sidebarLink(page, "Skills"));
  // The tab bar renders before the page hydrates; a click that lands early is dropped.
  await expect(page.getByText("Sync preview")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const personaTab = page.getByRole("tab", { name: "Persona" });
  await clickOn(page, personaTab);
  const sync = page.getByRole("button", { name: "Sync to all tools" });
  if (!(await sync.isVisible({ timeout: 5_000 }).catch(() => false))) {
    await personaTab.click();
  }
  await expect(sync).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await clickOn(page, sync);
  await expect(page.getByText(/Persona synced to Claude/)).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(2200);
  await keyFrame(page, "3-persona-sync");

  // 4. Search
  await setCaption(page, "Search notes, learnings, tasks and docs");
  await clickOn(page, sidebarLink(page, "Search"));
  const query = page.getByPlaceholder(/Search notes, learnings/);
  await clickOn(page, query);
  await query.pressSequentially("lockfile", { delay: 90 });
  await page.keyboard.press("Enter");
  await expect(page.getByText("learnings/npm-11-lockfile").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3200);
  await keyFrame(page, "4-search");
}

async function main(): Promise<void> {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const browser = await chromium.launch();
  const contextOptions = { viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark" as const };

  // Dev mode compiles each route on first hit; warm them so the GIF shows pages, not
  // spinners. A separate context keeps the warm-up out of the recorded breadcrumbs.
  const warmup = await browser.newContext(contextOptions);
  const warmPage = await warmup.newPage();
  for (const route of ["/notes/meetings/checkout-retro", "/skills", "/search", "/"]) {
    await warmPage.goto(new URL(route, BASE_URL).toString());
    await hydrated(warmPage);
  }
  await warmup.close();

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(OVERLAY_SCRIPT);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL);
    await hydrated(page);
    await expect(page.getByText("Pin Node 22 in the deploy image")).toBeVisible();
    // GitHub shows the first frame until the GIF loads, so it should explain itself.
    await setCaption(page, "Today: tasks, notes, calendar and PRs in one place");
    await page.waitForTimeout(2000);

    const stop = await startScreencast(page);
    await walk(page);
    const { frames, stoppedAt } = await stop();
    const count = await encodeGif(frames, stoppedAt);
    console.log(`Encoded ${count} frames from ${frames.length} screencast frames`);
  } catch (err) {
    await page.screenshot({ path: path.join(FRAMES_DIR, "failure.png") }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
