#!/usr/bin/env node
/**
 * Notes editor typing/click latency harness.
 *
 *   BASE_URL=http://127.0.0.1:1344 node scripts/perf/notes-editor-bench.mjs [--label before] [--out file.json]
 *
 * Seeds a large note (headings, lists, toggles, ~14 big images) through the
 * dashboard API, then drives Chromium: types into the middle of the note and
 * clicks around it. Run it against a dev server pointed at a scratch NOTES_DIR
 * (see docs in the PR) — it writes `perf-bench/large-note` there.
 *
 * Reports per-keystroke key→next-paint latency (p50/p95/max), Event Timing
 * durations, long tasks, React commits + render time per keystroke, and save
 * requests fired while typing.
 */
import { chromium } from "playwright";
import zlib from "node:zlib";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:1344";
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const LABEL = arg("label", "run");
const OUT = arg("out", "");
const NOTE = "perf-bench/large-note";
const KEYSTROKES = Number(arg("keys", 80));
const CLICKS = Number(arg("clicks", 30));
const PROFILE = args.includes("--profile");
const IMAGE_COUNT = 14;
// requireDashboardAuth accepts same-origin requests.
const SAME_ORIGIN = { Origin: BASE, Referer: `${BASE}/` };

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Noisy RGB PNG so it neither compresses away nor decodes trivially. */
function noisePng(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let s = seed;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w * 3; x++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      raw[row + 1 + x] = (s >>> 24) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function uploadImage(seed) {
  const form = new FormData();
  form.set("file", new Blob([noisePng(1200, 800, seed)], { type: "image/png" }), `shot-${seed}.png`);
  const res = await fetch(`${BASE}/api/notes-media`, { method: "POST", body: form, headers: SAME_ORIGIN });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).url;
}

const text = (t) => [{ type: "text", text: t, styles: {} }];
const block = (type, t, props = {}, children = []) => ({
  id: crypto.randomUUID(),
  type,
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left", ...props },
  content: text(t),
  children,
});
const lorem = (n) =>
  `Paragraph ${n}: the quick brown fox jumps over the lazy dog while the Android build keeps failing on tablets. `.repeat(2);

async function seedNote() {
  const urls = [];
  for (let i = 0; i < IMAGE_COUNT; i++) urls.push(await uploadImage(i + 1));
  const blocks = [block("heading", "Perf bench: large note", { level: 1 })];
  for (let section = 0; section < 12; section++) {
    blocks.push(block("heading", `Section ${section}`, { level: 2 }));
    for (let p = 0; p < 12; p++) blocks.push(block("paragraph", lorem(section * 12 + p)));
    for (let l = 0; l < 6; l++) blocks.push(block("bulletListItem", `Bullet ${section}.${l} with some detail`));
    for (let l = 0; l < 4; l++) blocks.push(block("numberedListItem", `Numbered ${section}.${l} issue text`));
    const url = urls[section % urls.length];
    blocks.push({
      ...block("toggleListItem", `Toggle ${section}: Android Tablet screenshot`),
      children: [
        { id: crypto.randomUUID(), type: "image", props: { url, caption: "", name: "shot.png", showPreview: true, textAlignment: "left", backgroundColor: "default" }, children: [] },
        block("paragraph", ""),
      ],
    });
    if (section % 2 === 0) {
      blocks.push({ id: crypto.randomUUID(), type: "image", props: { url: urls[(section + 5) % urls.length], caption: "", name: "shot.png", showPreview: true, textAlignment: "left", backgroundColor: "default" }, children: [] });
    }
  }
  const res = await fetch(`${BASE}/api/notes/${NOTE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...SAME_ORIGIN },
    body: JSON.stringify({ content: blocks }),
  });
  if (!res.ok && res.status !== 409) throw new Error(`seed failed: ${res.status} ${await res.text()}`);
  if (res.status === 409) {
    const put = await fetch(`${BASE}/api/notes/${NOTE}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...SAME_ORIGIN },
      body: JSON.stringify({ content: blocks }),
    });
    if (!put.ok) throw new Error(`seed PUT failed: ${put.status}`);
  }
  return blocks.length;
}

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(1);
};
const stats = (arr) => ({
  n: arr.length,
  mean: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0,
  p50: pct(arr, 50),
  p95: pct(arr, 95),
  max: arr.length ? +Math.max(...arr).toFixed(1) : 0,
});

const INIT = (profile) => {
  const w = window;
  w.__perf = { commits: 0, renderMs: 0, longTasks: [], events: [], keyLat: [], clickLat: [], mark: "" };
  // Minimal DevTools hook: React reports every commit; root.current.actualDuration is the render cost.
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject() { return 1; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      w.__perf.commits++;
      w.__perf.renderMs += root?.current?.actualDuration ?? 0;
      if (!profile) return;
      // --profile: which function components actually re-rendered in this commit.
      const counts = (w.__perf.rendered ??= {});
      const walk = (f) => {
        for (; f; f = f.sibling) {
          // Fibers skipped by a bailout keep stale flags; actualStartTime tells us it rendered this pass.
          if ((f.flags & 1) !== 0 && f.actualStartTime > (w.__lastCommit ?? 0) && typeof f.type === "function") {
            const name = f.type.displayName || f.type.name || "(anon)";
            counts[name] = (counts[name] ?? 0) + 1;
          }
          if (f.child) walk(f.child);
        }
      };
      walk(root.current);
      w.__lastCommit = performance.now();
    },
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__perf.longTasks.push({ d: e.duration, mark: w.__perf.mark });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__perf.events.push({ name: e.name, d: e.duration, proc: e.processingEnd - e.processingStart, mark: w.__perf.mark });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  const afterPaint = (cb) => requestAnimationFrame(() => setTimeout(cb, 0));
  addEventListener("keydown", () => {
    const t0 = performance.now();
    afterPaint(() => w.__perf.keyLat.push(performance.now() - t0));
  }, true);
  addEventListener("mousedown", () => {
    const t0 = performance.now();
    afterPaint(() => w.__perf.clickLat.push(performance.now() - t0));
  }, true);
};

/** Top self-time frames from a V8 CPU profile (CDP), to see where a phase spends its time. */
function topSelf(profile, limit = 18) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    self.set(id, (self.get(id) ?? 0) + dt);
  });
  const agg = new Map();
  for (const [id, us] of self) {
    const cf = byId.get(id).callFrame;
    const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").slice(-2).join("/")}:${cf.lineNumber}`;
    agg.set(key, (agg.get(key) ?? 0) + us);
  }
  return [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)}ms  ${k}`);
}

async function main() {
  const blockCount = await seedNote();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(INIT, PROFILE);
  const saves = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes(`/api/notes/${NOTE}`)) saves.push(Date.now());
  });

  await page.goto(`${BASE}/notes/${NOTE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".bn-editor", { timeout: 120_000 });
  await page.waitForFunction(() => document.querySelectorAll(".bn-block-content").length > 100);
  // Measure explicit image decoding, then let initial work settle before interaction timing.
  await page.waitForLoadState("networkidle").catch(() => {});
  const imageDecodeMs = await page.evaluate(async () => {
    const start = performance.now();
    await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)));
    return +(performance.now() - start).toFixed(1);
  });
  await page.waitForTimeout(3000);

  const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  const imgCount = await page.evaluate(() => document.images.length);

  // --- typing: middle of the note ---
  const paras = page.locator('.bn-block-content[data-content-type="paragraph"]');
  const target = paras.nth(Math.floor((await paras.count()) / 2));
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.keyboard.press("End");
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = window.__perf;
    p.commits = 0; p.renderMs = 0; p.longTasks = []; p.events = []; p.keyLat = []; p.clickLat = []; p.mark = "typing"; p.rendered = {};
  });
  const cdp = PROFILE ? await context.newCDPSession(page) : null;
  const startProfile = async () => { if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); } };
  const stopProfile = async (name) => {
    if (!cdp) return;
    const { profile } = await cdp.send("Profiler.stop");
    console.error(`--- CPU self time: ${name}\n${topSelf(profile).join("\n")}`);
  };
  // Browser-side time split (script vs style vs layout) via CDP Performance metrics.
  const metrics = await context.newCDPSession(page);
  await metrics.send("Performance.enable");
  const readMetrics = async () => Object.fromEntries((await metrics.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const split = (a, b) => ({
    scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
    styleMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
    layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
    styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
    layouts: b.LayoutCount - a.LayoutCount,
    taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
  });
  const savesBefore = saves.length;
  const m0 = await readMetrics();
  await startProfile();
  const phrase = "The quick brown fox types steadily through the Android tablet notes. ";
  await page.keyboard.type(phrase.repeat(Math.ceil(KEYSTROKES / phrase.length)).slice(0, KEYSTROKES), { delay: 35 });
  await page.waitForTimeout(400);
  await stopProfile("typing");
  const typingSplit = split(m0, await readMetrics());
  if (PROFILE) console.error("--- re-rendered components (typing)\n" + Object.entries(await page.evaluate(() => window.__perf.rendered)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${String(c).padStart(6)}  ${n}`).join("\n"));
  const typing = await page.evaluate(() => JSON.parse(JSON.stringify(window.__perf)));
  const typingSaves = saves.length - savesBefore;

  // --- clicking around ---
  await page.waitForTimeout(2500); // let the debounced save settle
  const settledSaves = saves.length - savesBefore;
  await page.evaluate(() => {
    const p = window.__perf;
    p.commits = 0; p.renderMs = 0; p.longTasks = []; p.events = []; p.keyLat = []; p.clickLat = []; p.mark = "clicking"; p.rendered = {};
  });
  const m1 = await readMetrics();
  await startProfile();
  const count = await paras.count();
  for (let i = 0; i < CLICKS; i++) {
    const loc = paras.nth(Math.floor(((i * 7 + 3) % CLICKS) * (count / CLICKS)));
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ position: { x: 20, y: 6 } });
    await page.waitForTimeout(120);
  }
  await stopProfile("clicking");
  const clickingSplit = split(m1, await readMetrics());
  if (PROFILE) console.error("--- re-rendered components (clicking)\n" + Object.entries(await page.evaluate(() => window.__perf.rendered)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${String(c).padStart(6)}  ${n}`).join("\n"));
  const clicking = await page.evaluate(() => JSON.parse(JSON.stringify(window.__perf)));

  const keyEvents = typing.events.filter((e) => ["keydown", "keypress", "keyup", "input", "beforeinput"].includes(e.name));
  const result = {
    label: LABEL,
    base: BASE,
    note: { blocks: blockCount, domNodes, images: imgCount, imageDecodeMs },
    typing: {
      keystrokes: KEYSTROKES,
      keyToPaintMs: stats(typing.keyLat),
      slowKeyEvents: keyEvents.length,
      eventTimingMaxMs: keyEvents.length ? Math.max(...keyEvents.map((e) => e.d)) : 0,
      reactCommitsPerKeystroke: +(typing.commits / KEYSTROKES).toFixed(2),
      reactRenderMsPerKeystroke: +(typing.renderMs / KEYSTROKES).toFixed(2),
      longTasks: typing.longTasks.length,
      longTaskTotalMs: +typing.longTasks.reduce((a, t) => a + t.d, 0).toFixed(0),
      longTaskMaxMs: typing.longTasks.length ? +Math.max(...typing.longTasks.map((t) => t.d)).toFixed(0) : 0,
      saveRequests: typingSaves,
      saveRequestsAfterSettle: settledSaves,
      browserTime: typingSplit,
    },
    clicking: {
      clicks: CLICKS,
      clickToPaintMs: stats(clicking.clickLat),
      reactCommitsPerClick: +(clicking.commits / CLICKS).toFixed(2),
      reactRenderMsPerClick: +(clicking.renderMs / CLICKS).toFixed(2),
      longTasks: clicking.longTasks.length,
      longTaskTotalMs: +clicking.longTasks.reduce((a, t) => a + t.d, 0).toFixed(0),
      browserTime: clickingSplit,
    },
  };
  await page.screenshot({ path: OUT ? OUT.replace(/\.json$/, ".png") : `/tmp/devhub-perf/${LABEL}.png` });
  await browser.close();
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (OUT) fs.writeFileSync(OUT, json);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
