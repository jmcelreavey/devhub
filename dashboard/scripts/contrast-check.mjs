#!/usr/bin/env node
/**
 * WCAG contrast audit for every theme preset × mode in globals.css.
 * Hard-fails (exit 1) on body-text pairs below AA 4.5:1 and accent-fg below 4.5:1.
 * Warns on hint-text (--text-subtle) below 4.5 and status/accent colors below 3:1.
 * Usage: node scripts/contrast-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

function parseColor(raw) {
  let v = raw.trim().replace(/;$/, "");
  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [((n >> 24) & 255) || ((n >> 16) & 255), (n >> 8) & 255, n & 255, 255].slice(0, 3).map((x, i) => (h.length === 8 && i === 0 ? (n >> 24) & 255 : x));
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Resolve var() references (one level, e.g. --bg-muted: var(--bg-elevated)).
function resolve(name, vars, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = vars[name];
  if (raw === undefined) return null;
  const ref = raw.match(/^var\((--[\w-]+)\)/);
  if (ref) return resolve(ref[1], vars, seen);
  return parseColor(raw);
}

// Extract every rule block that defines theme vars.
const themes = new Map();
const blockRe = /(^|\n)([^{}\n]+)\{([^{}]*)\}/g;
let m;
while ((m = blockRe.exec(css)) !== null) {
  const selector = m[2].trim();
  const body = m[3];
  if (!body.includes("--bg:") || !body.includes("--text:")) continue;
  const vars = {};
  for (const line of body.split(";")) {
    const vm = line.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
    if (vm) vars[vm[1]] = vm[2].trim();
  }
  let preset = "forest";
  let mode = "dark";
  const pm = selector.match(/data-theme-preset="(\w+)"/);
  if (pm) preset = pm[1];
  if (/data-theme="light"/.test(selector)) mode = "light";
  const key = `${preset}:${mode}`;
  if (!themes.has(key)) themes.set(key, vars); // first (most specific) wins
}

const REQUIRED = [
  ["text / bg", "--text", "--bg", 4.5],
  ["text / surface", "--text", "--bg-surface", 4.5],
  ["muted / bg", "--text-muted", "--bg", 4.5],
  ["muted / surface", "--text-muted", "--bg-surface", 4.5],
  ["muted / elevated", "--text-muted", "--bg-elevated", 4.5],
  ["accent-fg / accent (buttons)", "--accent-fg", "--accent", 4.5],
];

const WARNED = [
  ["subtle / surface (hints)", "--text-subtle", "--bg-surface", 4.5],
  ["accent / surface (links)", "--accent", "--bg-surface", 4.5],
  ["success / surface", "--success", "--bg-surface", 3.0],
  ["warning / surface", "--warning", "--bg-surface", 3.0],
  ["danger / surface", "--danger", "--bg-surface", 3.0],
];

let failures = 0;
let warnings = 0;
for (const [key, vars] of [...themes.entries()].sort()) {
  for (const [label, fgVar, bgVar, min] of REQUIRED) {
    const fg = resolve(fgVar, vars);
    const bg = resolve(bgVar, vars);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio < min) {
      failures++;
      console.log(`FAIL  ${key}  ${label}: ${ratio.toFixed(2)}:1 (min ${min})`);
    }
  }
  for (const [label, fgVar, bgVar, min] of WARNED) {
    const fg = resolve(fgVar, vars);
    const bg = resolve(bgVar, vars);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio < min) {
      warnings++;
      console.log(`WARN  ${key}  ${label}: ${ratio.toFixed(2)}:1 (target ${min})`);
    }
  }
}

console.log(`\n${themes.size} theme variants checked · ${failures} failures · ${warnings} warnings`);
process.exit(failures > 0 ? 1 : 0);
