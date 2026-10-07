/**
 * Shared pieces for the demo recorders (record-readme-demo.ts, record-walkthroughs.ts).
 *
 * Both drive the real dashboard against the disposable fixture built by
 * scripts/demos/record.sh, so none of this is safe to point at a dashboard you use.
 */
import { createHash } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

export const VIEWPORT = { width: 1280, height: 800 };

/** GitHub renders README images at most ~1000px wide; capturing larger only costs bytes. */
export const GIF_SIZE = { width: 1024, height: 640 };
const GIF_FPS = 10;
const GIF_MAX_HOLD_MS = 3000;

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${name} is not set — run this through npm run demos:record\n`);
    process.exit(1);
  }
  return value;
}

/** Fake cursor and caption: headless captures show neither, and a silent clip needs both. */
export const OVERLAY_SCRIPT = `
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

export async function setCaption(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    sessionStorage.setItem("demo-caption", value);
    const el = document.getElementById("demo-caption");
    if (el) el.textContent = value;
  }, text);
}

/** Glide the fake cursor to an element, then click it. */
export async function clickOn(page: Page, target: Locator): Promise<void> {
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

/** Glide the fake cursor over an element without clicking — for pointing things out. */
export async function pointAt(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`No bounding box for ${target}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}

export async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /search everything/i })).toBeEnabled({ timeout: 90_000 });
  await page.waitForFunction(() => document.readyState === "complete");
}

export function sidebarLink(page: Page, name: string): Locator {
  return page.locator("aside nav").getByRole("link", { name, exact: true }).first();
}

export interface Frame {
  png: Buffer;
  /** Seconds, on the screencast's clock. */
  at: number;
}

/**
 * Resamples paint-driven frames onto a fixed clock and writes an animated GIF with sharp
 * (no ffmpeg). Identical consecutive frames merge into one longer delay, which is what
 * keeps a mostly-still UI clip small.
 */
export async function encodeGif(
  frames: Frame[],
  stoppedAt: number,
  out: string,
  size: { width: number; height: number } = GIF_SIZE,
): Promise<number> {
  if (frames.length === 0) throw new Error("Screencast captured no frames");
  const stepMs = 1000 / GIF_FPS;
  const picked: { png: Buffer; delayMs: number; hash: string }[] = [];
  let index = 0;
  for (let t = frames[0].at; t < stoppedAt; t += stepMs / 1000) {
    while (index + 1 < frames.length && frames[index + 1].at <= t) index++;
    const hash = createHash("sha1").update(frames[index].png).digest("hex");
    const last = picked.at(-1);
    // Cap how long one unchanged frame holds, so waits on the server read as a beat, not dead air.
    if (last?.hash === hash) last.delayMs = Math.min(last.delayMs + stepMs, GIF_MAX_HOLD_MS);
    else picked.push({ png: frames[index].png, delayMs: stepMs, hash });
  }

  // Every frame of an animated join must share one size.
  const sized = await Promise.all(
    picked.map((p) => sharp(p.png).resize(size.width, size.height, { fit: "fill" }).png().toBuffer()),
  );
  await sharp(sized, { join: { animated: true }, limitInputPixels: false })
    .gif({
      delay: picked.map((p) => Math.round(p.delayMs)),
      loop: 0,
      effort: 8,
      dither: 0,
      interFrameMaxError: 4,
    })
    .toFile(out);
  return picked.length;
}

/**
 * CDP screencast rather than Playwright's video recorder: frames arrive as lossless PNGs,
 * so text stays sharp whatever they are encoded into. Chrome only emits a frame when the
 * page paints, so callers resample onto a fixed clock.
 */
export async function startScreencast(
  page: Page,
  size: { width: number; height: number },
): Promise<() => Promise<{ frames: Frame[]; stoppedAt: number }>> {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  cdp.on("Page.screencastFrame", (event) => {
    frames.push({ png: Buffer.from(event.data, "base64"), at: event.metadata.timestamp ?? Date.now() / 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "png",
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });
  return async () => {
    await cdp.send("Page.stopScreencast");
    const stoppedAt = Date.now() / 1000;
    await cdp.detach();
    return { frames, stoppedAt };
  };
}
