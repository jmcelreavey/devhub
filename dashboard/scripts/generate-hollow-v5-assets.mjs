/**
 * Hollow v5: authored carved bottle, candlelight and fine corner webs.
 * No external artwork. Static vector shading is baked into high resolution plates.
 * The haze and shadow are seeded exposure fields baked once, never per frame.
 * Run from dashboard: node scripts/generate-hollow-v5-assets.mjs
 */
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";

const out = new URL("../public/hollow/", import.meta.url);
await mkdir(out, { recursive: true });
const clamp = (n) => Math.max(0, Math.min(1, n));
const smooth = (n) => { const v = clamp(n); return v * v * (3 - 2 * v); };
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
const gaussian = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
async function plate(name, width, height, pixel) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixel(x, y).forEach((v, c) => { pixels[(y * width + x) * 4 + c] = Math.round(clamp(v) * 255); });
  }
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .webp({ quality: 88, alphaQuality: name === "bottle.webp" ? 90 : 65 }).toFile(new URL(name, out).pathname);
}
// SVG is authored at vector resolution; bake once at > 6x the 112px boot mark.
// This keeps WebKit free of live turbulence/blur filters.
const art = await readFile(new URL("lantern-bottle.svg", out), "utf8");
await sharp(Buffer.from(art), { density: 460 }).resize(768, 768, { fit: "contain", background: "#00000000" })
  .webp({ quality: 96, alphaQuality: 100 }).toFile(new URL("bottle.webp", out).pathname);
const defs = art.slice(art.indexOf("<defs>"), art.indexOf("</defs>") + 7);
const candle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 180">${defs}<use href="#face" fill="#ffc764" opacity=".7" filter="url(#bloom)"/><use href="#face" fill="#ffe9a0" opacity=".32"/></svg>`;
await sharp(Buffer.from(candle), { density: 460 }).resize(768, 768, { fit: "contain", background: "#00000000" })
  .webp({ quality: 94, alphaQuality: 100 }).toFile(new URL("candlelight.webp", out).pathname);
const angles = [0, .18, .41, .7, 1.02, 1.3, Math.PI / 2];
const point = (radius, angle) => [3 + Math.cos(angle) * radius, 3 + Math.sin(angle) * radius];
const paths = angles.map((angle, index) => {
  const [x, y] = point(210 - index * 5, angle);
  return `M3 3 Q${x * .5} ${y * .5} ${x} ${y}`;
});
for (const radius of [14, 30, 52, 80, 115, 158, 206]) {
  for (let i = 0; i < angles.length - 1; i++) {
    const a = point(radius, angles[i]), b = point(radius, angles[i + 1]);
    const c = point(radius * .87, (angles[i] + angles[i + 1]) / 2);
    paths.push(`M${a} Q${c} ${b}`);
  }
}
const web = `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="180"><defs><radialGradient id="fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="220"><stop stop-color="#e4e4cb" stop-opacity=".75"/><stop offset=".65" stop-color="#b0c6bb" stop-opacity=".48"/><stop offset="1" stop-color="#adbeae" stop-opacity="0"/></radialGradient></defs><g fill="none" stroke="url(#fade)" stroke-width=".7" stroke-linecap="round">${paths.map(d => `<path d="${d}"/>`).join("")}</g></svg>`;
await sharp(Buffer.from(web), { density: 220 }).webp({ quality: 92, alphaQuality: 100 })
  .toFile(new URL("cobweb.webp", out).pathname);
await plate("feather.webp", 512, 512, (x, y) => {
  const edge = smooth(Math.min(x, 511 - x) / 40) * smooth(Math.min(y, 511 - y) / 65);
  return [1, 1, 1, edge];
});
await plate("fog-density.webp", 512, 512, (x, y) => {
  const edge = smooth(Math.min(x, 511 - x) / 90) * smooth(Math.min(y, 511 - y) / 100);
  const density = .48 + .2 * Math.sin(x / 51 + Math.sin(y / 67) * 2)
    + .12 * Math.sin(y / 29 + Math.cos(x / 73)) + (hash(x, y) - .5) * .05;
  return [1, 1, 1, edge * density];
});
await plate("passing-shadow.webp", 256, 512, (px, py) => {
  const x = px / 256, y = py / 512;
  const head = gaussian(x, y, .46, .26, .09, .11);
  const shoulders = gaussian(x, y, .5, .53, .29, .23);
  const trailing = gaussian(x, y, .64, .8, .2, .35);
  const density = clamp(head + shoulders * .86 + trailing * .6);
  const edge = smooth(Math.min(px, 255 - px) / 30) * smooth(Math.min(py, 511 - py) / 70);
  return [.012, .008, .018, density * edge * (.88 + hash(px, py) * .12)];
});
console.log("Generated bottle, candlelight, cobweb, feather, fog-density and passing-shadow plates.");
