#!/usr/bin/env node
/**
 * Draw the Shift Dock mark and rasterise it at every size DevHub ships.
 *
 * Shift Dock is three rounded rows. The middle row is shorter and ends in a lime
 * hub docked into the stack. Graphite Neon only: charcoal #111416, light #f7f8f9,
 * lime #9ed84a (dark) / #4c840c (light), plus a softer second lime tint on the
 * middle row and a faint lime halo around the hub.
 *
 * This file is the source of truth for the geometry. It writes:
 *   public/brand-mark-dark.svg, brand-mark-light.svg   sidebar / boot / mobile
 *   public/favicon-16.svg, favicon-16-light.svg        16px pixel grid, two schemes
 *   public/favicon.svg                                 pixel grid that follows prefers-color-scheme
 *   public/favicon.ico, favicon-16*.png, icon-32*.png  tab icons and the ICO fallback
 *   public/icon-master.svg + icon-{180,192,512,master}.png
 *   desktop/src-tauri/icons/*                          Tauri shell, tray, icns, ico
 *
 * Every raster is drawn from the vector at its own pixel size. Nothing is a
 * downscale of the 1024px master, so small sizes keep crisp edges.
 *
 *   npm run icons:pwa --prefix dashboard
 *
 * `--dashboard-only` skips desktop/src-tauri/icons. Needs sharp (SHARP_MODULE
 * overrides the lookup path).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || "sharp");

const dashboardDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(dashboardDir, "public");
const repoRoot = path.resolve(dashboardDir, "..");
const tauriIcons = path.join(repoRoot, "desktop", "src-tauri", "icons");

const PALETTES = {
  dark: { bg: "#111416", mod: "#9aa6b2", tint: "#5f8f2f", hub: "#9ed84a", halo: 0.18 },
  light: { bg: "#f7f8f9", mod: "#46545f", tint: "#669826", hub: "#4c840c", halo: 0.14 },
};

/** 64-unit mark box. The bounding box (5..59) is centred on 32,32. */
function markBody(p, { halo = true } = {}) {
  return [
    halo
      ? `<rect x="34" y="18" width="28" height="28" rx="8" fill="${p.hub}" fill-opacity="${p.halo}"/>`
      : "",
    `<rect x="5" y="5" width="40" height="12" rx="6" fill="${p.mod}"/>`,
    `<rect x="5" y="47" width="40" height="12" rx="6" fill="${p.mod}"/>`,
    `<rect x="5" y="26" width="28" height="12" rx="6" fill="${p.tint}"/>`,
    `<rect x="37" y="21" width="22" height="22" rx="5" fill="${p.hub}"/>`,
  ].join("");
}

const A11Y = `role="img" aria-label="DevHub"><title>DevHub</title>`;

function markSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" ${A11Y}${markBody(p)}</svg>\n`;
}

/**
 * 16x16 pixel grid. Integer rects only, so nothing anti-aliases at native size.
 * Top and bottom rows are 10 wide, the middle row 7 wide, the hub 6 square with a
 * 1px dock gap — the same 1:4 proportions as the 64-unit mark.
 */
function faviconBody(p) {
  return [
    `<rect x="1" y="1" width="10" height="3" fill="${p.mod}"/>`,
    `<rect x="1" y="12" width="10" height="3" fill="${p.mod}"/>`,
    `<rect x="1" y="6" width="7" height="4" fill="${p.tint}"/>`,
    `<rect x="9" y="5" width="6" height="6" fill="${p.hub}"/>`,
  ].join("");
}

function faviconSvg(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges" ${A11Y}${faviconBody(p)}</svg>\n`;
}

/** One file that follows the browser scheme. Light ink is the default so a renderer that ignores the media query stays readable on white. */
function faviconSchemeSvg() {
  const { light, dark } = PALETTES;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges" ${A11Y}
<style>
.m { fill: ${light.mod} }
.t { fill: ${light.tint} }
.c { fill: ${light.hub} }
@media (prefers-color-scheme: dark) {
  .m { fill: ${dark.mod} }
  .t { fill: ${dark.tint} }
  .c { fill: ${dark.hub} }
}
</style>
<rect class="m" x="1" y="1" width="10" height="3"/>
<rect class="m" x="1" y="12" width="10" height="3"/>
<rect class="t" x="1" y="6" width="7" height="4"/>
<rect class="c" x="9" y="5" width="6" height="6"/>
</svg>
`;
}

/**
 * Full-bleed app tile (the OS applies its own mask). A soft lime glow sits behind
 * the hub. `markScale` is the 64-unit box as a fraction of the tile.
 */
function tileSvg(size, markScale) {
  const p = PALETTES.dark;
  const s = size * markScale;
  const u = s / 64;
  const hubX = size / 2 + (48 - 32) * u;
  const hubY = size / 2;
  const glowR = size * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ${A11Y}<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${hubX.toFixed(2)}" cy="${hubY.toFixed(2)}" r="${glowR.toFixed(2)}"><stop offset="0" stop-color="${p.hub}" stop-opacity="0.24"/><stop offset="1" stop-color="${p.hub}" stop-opacity="0"/></radialGradient></defs><rect width="${size}" height="${size}" fill="${p.bg}"/><rect width="${size}" height="${size}" fill="url(#g)"/><g transform="translate(${size / 2} ${size / 2}) scale(${u.toFixed(5)}) translate(-32 -32)">${markBody(p)}</g></svg>\n`;
}

/** The mark alone on transparent, for small OS icon frames where a tile would shrink it. */
function bareSvg(size) {
  const p = PALETTES.dark;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" ${A11Y}${markBody(p, { halo: false })}</svg>`;
}

/** Black plus alpha for the macOS menu bar. The hub is solid; the rows are softer. */
function traySvg(size) {
  const row = `fill="#000" fill-opacity="0.55"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><rect x="5" y="5" width="40" height="12" rx="6" ${row}/><rect x="5" y="47" width="40" height="12" rx="6" ${row}/><rect x="5" y="26" width="28" height="12" rx="6" ${row}/><rect x="37" y="21" width="22" height="22" rx="5" fill="#000"/></svg>`;
}

const png = (svg) => sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 });

async function pngBuffer(svg) {
  return png(svg).toBuffer();
}

/** Nearest-neighbour multiple of the 16px grid. */
async function gridPng(p, size) {
  const base = await pngBuffer(faviconSvg(p));
  return sharp(base).resize(size, size, { kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer();
}

/** The mark fills 66% of the tile, 78% at 64px and under so the rows survive. */
const tileMarkScale = (size) => (size <= 64 ? 0.92 : 0.78);

/** App tile PNG drawn at its own size. */
function tilePng(size) {
  return pngBuffer(tileSvg(size, tileMarkScale(size)));
}

function writeFile(dest, data) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
}

/** PNG-in-ICO directory. Frames are already-encoded PNGs. */
function icoBuffer(frames) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, buffer }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buffer.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return e;
  });
  return Buffer.concat([head, ...entries, ...frames.map((f) => f.buffer)]);
}

/** ICNS container of PNG chunks, so it builds on any OS. */
function icnsBuffer(chunks) {
  const body = chunks.map(({ type, buffer }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(buffer.length + 8, 4);
    return Buffer.concat([h, buffer]);
  });
  const total = 8 + body.reduce((n, b) => n + b.length, 0);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...body]);
}

async function renderDashboard() {
  const { dark, light } = PALETTES;
  writeFile(path.join(publicDir, "brand-mark-dark.svg"), markSvg(dark));
  writeFile(path.join(publicDir, "brand-mark-light.svg"), markSvg(light));
  writeFile(path.join(publicDir, "favicon-16.svg"), faviconSvg(dark));
  writeFile(path.join(publicDir, "favicon-16-light.svg"), faviconSvg(light));
  writeFile(path.join(publicDir, "favicon.svg"), faviconSchemeSvg());
  writeFile(path.join(publicDir, "icon-master.svg"), tileSvg(1024, tileMarkScale(1024)));

  writeFile(path.join(publicDir, "favicon-16.png"), await gridPng(dark, 16));
  writeFile(path.join(publicDir, "favicon-16-light.png"), await gridPng(light, 16));
  writeFile(path.join(publicDir, "icon-32.png"), await gridPng(dark, 32));
  writeFile(path.join(publicDir, "icon-32-light.png"), await gridPng(light, 32));

  // Unlinked fallback for clients that request /favicon.ico and never read
  // <link rel="icon">. Light ink stays readable on white. It must not live in
  // app/: Next injects app/favicon.ico first, and browsers that prefer .ico
  // then ignore the scheme-aware PNGs.
  writeFile(
    path.join(publicDir, "favicon.ico"),
    icoBuffer(
      await Promise.all([16, 32, 48].map(async (size) => ({ size, buffer: await gridPng(light, size) }))),
    ),
  );

  for (const size of [180, 192, 512, 1024]) {
    const name = size === 1024 ? "icon-master.png" : `icon-${size}.png`;
    writeFile(path.join(publicDir, name), await tilePng(size));
  }
}

async function renderDesktop() {
  writeFile(path.join(tauriIcons, "32x32.png"), await tilePng(32));
  writeFile(path.join(tauriIcons, "128x128.png"), await tilePng(128));
  writeFile(path.join(tauriIcons, "128x128@2x.png"), await tilePng(256));
  writeFile(path.join(tauriIcons, "icon.png"), await tilePng(512));

  writeFile(path.join(tauriIcons, "trayTemplate.png"), await pngBuffer(traySvg(22)));
  writeFile(path.join(tauriIcons, "trayTemplate@2x.png"), await pngBuffer(traySvg(44)));

  // Windows: 16 and 32 use the pixel grid on transparent so the taskbar stays
  // crisp; 24 is the bare mark drawn at 24; larger frames are the app tile.
  const ico = [
    { size: 16, buffer: await gridPng(PALETTES.dark, 16) },
    { size: 24, buffer: await pngBuffer(bareSvg(24)) },
    { size: 32, buffer: await gridPng(PALETTES.dark, 32) },
    { size: 48, buffer: await tilePng(48) },
    { size: 64, buffer: await tilePng(64) },
    { size: 256, buffer: await tilePng(256) },
  ];
  writeFile(path.join(tauriIcons, "icon.ico"), icoBuffer(ico));

  // macOS: every chunk is drawn at its own pixel size.
  const chunk = async (type, size) => ({ type, buffer: await tilePng(size) });
  const icns = await Promise.all([
    chunk("icp4", 16),
    chunk("icp5", 32),
    chunk("icp6", 64),
    chunk("ic07", 128),
    chunk("ic08", 256),
    chunk("ic09", 512),
    chunk("ic10", 1024),
    chunk("ic11", 32),
    chunk("ic12", 64),
    chunk("ic13", 256),
    chunk("ic14", 512),
  ]);
  writeFile(path.join(tauriIcons, "icon.icns"), icnsBuffer(icns));
}

async function main() {
  await renderDashboard();
  if (process.argv.includes("--dashboard-only")) {
    process.stdout.write("[render-brand-icons] wrote dashboard rasters\n");
    return;
  }
  await renderDesktop();
  process.stdout.write("[render-brand-icons] wrote dashboard and desktop rasters\n");
}

main().catch((err) => {
  process.stderr.write(`[render-brand-icons] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
