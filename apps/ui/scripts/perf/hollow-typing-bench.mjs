#!/usr/bin/env node
/**
 * Compare Hollow typing with Graphite using the real task-search input.
 * API fixtures are browser-local; no task or settings requests reach the server.
 * BASE_URL=http://127.0.0.1:1342 node scripts/perf/hollow-typing-bench.mjs /tmp/before.json
 * CPU_RATE=4 adds a repeatable CPU-throttled run; default is native speed.
 * VERIFY_UI=1 also checks light/dark, motion controls and idle cost; RUNS=0 skips typing.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://127.0.0.1:1342";
if (new URL(base).port === "1337") throw new Error("Use an isolated checkout server, not :1337.");
const cpuRate = Number(process.env.CPU_RATE ?? 1);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const page = await context.newPage();
page.on("pageerror", error => console.error("Browser error:", error.message));
// Other agents may edit this checkout; keep Fast Refresh out of the timed runs.
await page.routeWebSocket("**/_next/webpack-hmr*", socket => socket.close());
const tasks = Array.from({ length: 40 }, (_, i) => ({
  id: `perf-${i}`, text: `Review Halloween atmosphere task ${i}`, done: false, links: [], createdAt: "2026-10-20T09:00:00.000Z",
}));
await page.route("**/api/**", route => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/tasks") return route.fulfill({ json: { tasks, date: "2026-10-20" } });
  if (url.pathname === "/api/tasks/history") return route.fulfill({ json: [{ date: "2026-10-20", tasks }] });
  return route.fulfill({ status: 503, json: { error: "Disabled in the typing benchmark" } });
});
await page.addInitScript(() => {
  localStorage.setItem("devhub:theme", "dark");
  localStorage.setItem("devhub:theme-preset", "graphite");
  localStorage.setItem("devhub:hollow-season", JSON.stringify({ year: 2026, overridden: true }));
});
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2) : 0;
  return { count: sorted.length, p50: at(.5), p95: at(.95), max: at(1) };
};
try {
  await page.goto(`${base}/work?tab=tasks`,  { waitUntil: "domcontentloaded", timeout: 120000 });
  const input = page.getByRole("textbox", { name: "Search tasks", exact: true });
  await input.waitFor({ timeout: 120000 });
  console.log("Task search ready");
  await page.waitForTimeout(3000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  await page.evaluate(() => {
    const state = window.__hollowBench = { active: false, keys: [], events: [], longtasks: [], frames: [], scans: 0, ranges: 0 };
    for (const type of ["longtask", "event", "long-animation-frame"]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      new PerformanceObserver(list => {
        if (!state.active) return;
        for (const e of list.getEntries()) {
          if (type === "event" && ["keydown", "keypress", "keyup", "input", "beforeinput"].includes(e.name)) state.events.push(e.duration);
          if (type === "longtask") state.longtasks.push(e.duration);
          if (type === "long-animation-frame") state.frames.push(e.duration);
        }
      }).observe({ type, durationThreshold: 16 });
    }
    const walker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => { if (state.active && args[0] === document.body) state.scans++; return walker(...args); };
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () { if (state.active) state.ranges++; return rects.call(this); };
    window.addEventListener("keydown", event => {
      if (!state.active || event.key.length !== 1) return;
      const start = performance.now();
      requestAnimationFrame(() => setTimeout(() => { if (state.active) state.keys.push(performance.now() - start); }, 0));
    }, true);
  });
  const results = [];
  for (const mode of ["graphite", "hollow", "hollow-atmosphere-off"]) {
    await input.fill("");
    await input.blur();
    await page.evaluate(mode => {
      const preset = mode === "graphite" ? "graphite" : "hollow";
      localStorage.setItem("devhub:theme-preset", preset);
      document.documentElement.dataset.themePreset = preset;
      localStorage.setItem("devhub:hollow-effects", JSON.stringify({ atmosphere: mode !== "hollow-atmosphere-off" }));
      window.dispatchEvent(new Event("devhub:theme-change"));
      window.dispatchEvent(new Event("devhub:hollow-effects"));
    }, mode);
    await page.waitForTimeout(2500);
    console.log("Measuring", mode);
    await page.screenshot({ path: `${process.argv[2] ?? "/tmp/hollow" }-${mode}.png` });
    for (let run = 0; run < Number(process.env.RUNS ?? 3); run++) {
      await input.fill("");
      await input.focus();
      await page.waitForTimeout(1000);
      await page.evaluate(() => Object.assign(window.__hollowBench, { active: true, keys: [], events: [], longtasks: [], frames: [], scans: 0, ranges: 0 }));
      const before = await metrics();
      // Repeated query text drives React's empty-state text updates on every key.
      await page.keyboard.type("A steady typing benchmark preserves the Halloween atmosphere. ".repeat(2), { delay: 35 });
      await page.waitForTimeout(150);
      const after = await metrics();
      const raw = await page.evaluate(() => { window.__hollowBench.active = false; return { ...window.__hollowBench }; });
      const result = {
        mode, run, keyToPaint: stats(raw.keys), eventDuration: stats(raw.events),
        longTasks: stats(raw.longtasks), longFrames: stats(raw.frames), textScans: raw.scans, textRangeReads: raw.ranges,
        scriptMs: +(1000 * (after.ScriptDuration - before.ScriptDuration)).toFixed(1),
        styleMs: +(1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration)).toFixed(1),
        layoutMs: +(1000 * (after.LayoutDuration - before.LayoutDuration)).toFixed(1),
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  const visualChecks = [];
  const report = { visualChecks, base, browser: browser.version(), cpuRate, viewport: "1440x900", input: "Tasks search", keyDelayMs: 35, fixtures: "40 browser-local tasks; no writes", results };
  const save = () => { if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n"); };
  save();
  if (process.env.VERIFY_UI === "1") {
    await input.fill("");
    await input.blur();
    await page.evaluate(() => {
      localStorage.setItem("devhub:theme-preset", "hollow");
      localStorage.setItem("devhub:hollow-effects", "{}");
      document.documentElement.dataset.themePreset = "hollow";
      window.dispatchEvent(new Event("devhub:theme-change"));
      window.dispatchEvent(new Event("devhub:hollow-effects"));
    });
    await page.waitForTimeout(1000);
    const running = () => page.evaluate(() => document.getAnimations().filter(a =>
      a.playState === "running" && a.effect?.target instanceof Element
      && a.effect.target.closest(".hollow-fx")).length);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => {
        localStorage.setItem("devhub:theme", theme);
        document.documentElement.dataset.theme = theme;
        window.dispatchEvent(new Event("devhub:theme-change"));
      }, theme);
      await input.focus();
      await page.keyboard.type("Halloween atmosphere", { delay: 35 });
      await page.waitForTimeout(500);
      assert.equal(await running(), 0, "Atmosphere must freeze while editing");
      await page.locator(".hollow-scenery").waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await page.locator(".hollow-scenery").evaluate(el => getComputedStyle(el).visibility), "visible");
      await page.screenshot({ path: `${process.argv[2]}-${theme}-editing.png` });
      visualChecks.push(`${theme}: static atmosphere visible while editing`);
      await input.fill("");
      await input.blur();
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-hollow-paused")), false, "Blur must release the editing pause");
    }
    await page.evaluate(() => { document.body.dataset.motion = "off"; });
    await page.waitForTimeout(500);
    assert.equal(await running(), 0, "Motion kill-switch must stop effects");
    await page.evaluate(() => { delete document.body.dataset.motion; });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(500);
    assert.equal(await running(), 0, "Reduced motion must stop effects");
    visualChecks.push("body[data-motion=off] and reduced motion stop effects");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const preset of ["graphite", "hollow"]) {
      await page.evaluate(preset => {
        localStorage.setItem("devhub:theme-preset", preset);
        document.documentElement.dataset.themePreset = preset;
        window.dispatchEvent(new Event("devhub:theme-change"));
      }, preset);
      await page.waitForTimeout(1500);
      assert.equal(await page.locator(".hollow-fx").count(), preset === "hollow" ? 1 : 0);
      const before = await metrics();
      await page.evaluate(() => Object.assign(window.__hollowBench, { active: true, longtasks: [], frames: [], scans: 0, ranges: 0 }));
      await page.waitForTimeout(5000);
      const after = await metrics();
      const raw = await page.evaluate(() => { window.__hollowBench.active = false; return { ...window.__hollowBench }; });
      const idle = { preset, idleMs: 5000, longTasks: stats(raw.longtasks), longFrames: stats(raw.frames),
        scriptMs: +(1000 * (after.ScriptDuration - before.ScriptDuration)).toFixed(1),
        styleMs: +(1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration)).toFixed(1), textScans: raw.scans };
      visualChecks.push(idle);
      console.log(JSON.stringify(idle));
    }
  }
  save();
} finally {
  await browser.close();
}
