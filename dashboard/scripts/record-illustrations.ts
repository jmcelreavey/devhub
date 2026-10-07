#!/usr/bin/env tsx
/**
 * Renders the illustrated clips: each docs/assets/demos/src/<name>.html becomes
 * docs/assets/demos/<name>.gif.
 *
 * These are for flows a recording fixture can't honestly show — a live agent, real model
 * access, Cursor. Each page labels itself as an illustration. Nothing here touches a
 * dashboard, so it needs no fixture:
 *
 *   npm run demos:illustrations
 *
 * A page exposes `window.__play()` to start its timeline and sets `window.__done` when the
 * timeline has finished.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { encodeGif, startScreencast } from "./demo-kit";

// Run from dashboard/ (the npm script does), so the repo's docs live one level up.
const DEMOS_DIR = path.resolve(process.cwd(), "../docs/assets/demos");
const SRC_DIR = path.join(DEMOS_DIR, "src");

const PAGE_SIZE = { width: 1280, height: 720 };
const GIF_SIZE = { width: 1024, height: 576 };
/** Lets the last state sit on screen before the GIF loops. */
const HOLD_MS = 2500;

async function main(): Promise<void> {
  const sources = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".html"));
  if (sources.length === 0) throw new Error(`No .html sources in ${SRC_DIR}`);

  const browser = await chromium.launch();
  try {
    for (const file of sources) {
      const name = path.basename(file, ".html");
      const context = await browser.newContext({ viewport: PAGE_SIZE, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await page.goto(pathToFileURL(path.join(SRC_DIR, file)).toString());
      await page.waitForTimeout(300);

      const stop = await startScreencast(page, PAGE_SIZE);
      await page.evaluate(() => (window as unknown as { __play: () => void }).__play());
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, {
        timeout: 120_000,
      });
      await page.waitForTimeout(HOLD_MS);
      const { frames, stoppedAt } = await stop();

      const out = path.join(DEMOS_DIR, `${name}.gif`);
      const count = await encodeGif(frames, stoppedAt, out, GIF_SIZE);
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(`${name}: ${count} frames, ${kb} KB → ${out}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
