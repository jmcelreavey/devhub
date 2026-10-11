#!/usr/bin/env node
// Renders every PongAudio sound and both music loops offline in headless
// Chromium and reports peak / RMS, so levels and silence regressions are
// caught without a speaker. Optionally writes WAVs: --wav <dir>.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const dashboard = path.join(repoRoot, "dashboard");
const require = createRequire(path.join(dashboard, "package.json"));
const esbuild = require("esbuild");
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const wavDir = args.includes("--wav") ? path.resolve(args[args.indexOf("--wav") + 1]) : null;

const out = fs.mkdtempSync(path.join(os.tmpdir(), "pong-audio-"));
await esbuild.build({
  entryPoints: [path.join(dashboard, "lib/pong/audio.ts")],
  outfile: path.join(out, "audio.js"),
  bundle: true, format: "iife", globalName: "PongAudioMod", platform: "browser", logLevel: "warning",
});
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ path: path.join(out, "audio.js") });

const results = await page.evaluate(async () => {
  const { PongAudio, TRACKS } = window.PongAudioMod;
  const RATE = 44100;
  const render = async (seconds, fn) => {
    const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
    Object.defineProperty(ctx, "state", { get: () => "running" });
    const saved = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    const a = new PongAudio();
    a.ensure();
    window.AudioContext = saved;
    fn(a, ctx);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0, last = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      sum += d[i] * d[i];
      if (v > 0.002) last = i;
    }
    // loudest 1s window and where it is, to spot a single runaway voice
    let worst = 0, worstAt = 0;
    for (let w = 0; w * RATE < d.length; w++) {
      let p2 = 0;
      for (let i = w * RATE; i < Math.min(d.length, (w + 1) * RATE); i++) p2 = Math.max(p2, Math.abs(d[i]));
      if (p2 > worst) { worst = p2; worstAt = w; }
    }
    return { peak, rms: Math.sqrt(sum / d.length), tail: last / RATE, worstAt, samples: Array.from(d) };
  };
  const sfx = {
    "hit-sword": (a) => a.hit("sword", 0.5),
    "hit-sword-sweet": (a) => a.hit("sword", 0.8, true),
    "hit-axe": (a) => a.hit("axe", 0.5),
    "hit-hammer": (a) => a.hit("hammer", 0.5),
    "hit-staff": (a) => a.hit("staff", 0.5),
    "hit-foe": (a) => a.hit("sword", 0.5, false, true),
    whiff: (a) => a.whiff(),
    wall: (a) => a.wall(),
    score: (a) => a.score(),
    hurt: (a) => a.hurt(),
    shield: (a) => a.shield(),
    "powerup-grow": (a) => a.powerup("grow"),
    "powerup-multiball": (a) => a.powerup("multiball"),
    "powerup-slowmo": (a) => a.powerup("slowmo"),
    "powerup-shield": (a) => a.powerup("shield"),
    "powerup-heart": (a) => a.powerup("heart"),
    "monster-ghost": (a) => a.monster("ghost"),
    "monster-demon": (a) => a.monster("demon"),
    "monster-fairy": (a) => a.monster("fairy"),
    "monster-blob": (a) => a.monster("blob"),
    coin: (a) => a.coin(3),
    "shop-bell": (a) => a.shopBell(),
    buy: (a) => a.buy(),
    deny: (a) => a.deny(),
    equip: (a) => a.equip(),
    click: (a) => a.click(),
    "level-up": (a) => a.levelUp(),
    "game-over": (a) => a.gameOver(),
  };
  const res = {};
  const wavs = {};
  for (const [name, fn] of Object.entries(sfx)) {
    const r = await render(2.5, fn);
    res[name] = { peak: +r.peak.toFixed(3), rmsDb: +(20 * Math.log10(r.rms || 1e-9)).toFixed(1), tail: +r.tail.toFixed(2) };
    wavs[name] = r.samples;
  }
  for (const track of ["menu", "arena"]) {
    const def = TRACKS[track];
    const stepDur = 60 / def.bpm / 4;
    const steps = def.chords.length * 16;
    const r = await render(steps * stepDur + 1, (a, ctx) => {
      a.setMusic(null);
      a.track = track;
      a.voices = -1e6; // offline: onended never fires while scheduling, so lift the voice cap
      for (let s = 0; s < steps; s++) a.scheduleStep(def, s, s * stepDur, stepDur);
    });
    res[`music-${track}`] = { peak: +r.peak.toFixed(3), rmsDb: +(20 * Math.log10(r.rms || 1e-9)).toFixed(1), tail: +r.tail.toFixed(2), worstAt: r.worstAt, seconds: +(steps * stepDur).toFixed(1) };
    wavs[`music-${track}`] = r.samples;
  }
  return { res, wavs };
});

const wav = (samples) => {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(44100, 24);
  buf.writeUInt32LE(88200, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.max(-1, Math.min(1, v)) * 32767, 44 + i * 2));
  return buf;
};
if (wavDir) {
  fs.mkdirSync(wavDir, { recursive: true });
  for (const [name, samples] of Object.entries(results.wavs)) fs.writeFileSync(path.join(wavDir, `${name}.wav`), wav(samples));
}
let bad = 0;
console.log("sound".padEnd(20), "peak".padStart(6), "rms dB".padStart(8), "tail s".padStart(7));
for (const [name, r] of Object.entries(results.res)) {
  const flag = r.peak < 0.02 ? "  SILENT" : r.peak > 0.99 ? "  CLIPS" : "";
  if (flag) bad++;
  console.log(name.padEnd(20), String(r.peak).padStart(6), String(r.rmsDb).padStart(8), String(r.tail).padStart(7), flag, r.worstAt !== undefined ? `loudest@${r.worstAt}s` : "");
}
await browser.close();
fs.rmSync(out, { recursive: true, force: true });
if (bad) process.exitCode = 1;
