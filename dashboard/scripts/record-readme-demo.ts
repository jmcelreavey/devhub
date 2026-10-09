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
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import {
  clickOn,
  encodeGif,
  GIF_SIZE,
  hydrated,
  MAC_USER_AGENT,
  OVERLAY_SCRIPT,
  requiredEnv,
  setCaption,
  sidebarLink,
  startScreencast,
  THEME_PIN_SCRIPT,
  VIEWPORT,
} from "./demo-kit";

const BASE_URL = requiredEnv("DEMO_URL");
const OUT = requiredEnv("DEMO_OUT");
const FRAMES_DIR = requiredEnv("DEMO_FRAMES_DIR");

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
  // Wait for the landing's recent list: a production build navigates fast enough that
  // checking visibility straight away races the render and clicks a detaching node.
  await expect(page.getByText(/Picking up where you left off/i)).toBeVisible({ timeout: 60_000 });
  await clickOn(page, page.getByText("Checkout retro", { exact: true }).first());
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
  const contextOptions = { viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark" as const, userAgent: MAC_USER_AGENT };

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
  await context.addInitScript(THEME_PIN_SCRIPT);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL);
    await hydrated(page);
    await expect(page.getByText("Pin Node 22 in the deploy image")).toBeVisible();
    // GitHub shows the first frame until the GIF loads, so it should explain itself.
    await setCaption(page, "Today: tasks, notes, calendar and PRs in one place");
    await page.waitForTimeout(2000);

    const stop = await startScreencast(page, GIF_SIZE);
    await walk(page);
    const { frames, stoppedAt } = await stop();
    const count = await encodeGif(frames, stoppedAt, OUT);
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
