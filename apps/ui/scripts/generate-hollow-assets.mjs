/**
 * Authored procedural plates, no source imagery or runtime canvas.
 * Run from dashboard: node scripts/generate-hollow-assets.mjs
 * Sharp is already supplied by Next. All randomness is seeded.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const out = new URL("../public/hollow/", import.meta.url);
await mkdir(out, { recursive: true });
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => v * v * (3 - 2 * v);
function hash(x, y, seed = 17) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const b = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return a * (1 - fy) + b * fy;
}
function fractal(x, y) {
  return noise(x, y) * 0.54 + noise(x * 2, y * 2) * 0.27
    + noise(x * 4, y * 4) * 0.13 + noise(x * 8, y * 8) * 0.06;
}
async function plate(name, width, height, pixel) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = pixel(x, y);
      const offset = (y * width + x) * 4;
      rgba.forEach((v, i) => { bytes[offset + i] = Math.round(clamp(v) * 255); });
    }
  }
  await sharp(bytes, { raw: { width, height, channels: 4 } })
    .webp({ quality: 78, alphaQuality: 75 }).toFile(new URL(name, out).pathname);
}
await plate("grain.webp", 128, 128, (x, y) => {
  const n = hash(x, y);
  return [n, n, n, 1];
});
// A seamless fractal density field, used as a static alpha mask.
await plate("mist.webp", 256, 256, (x, y) => {
  const tx = x / 256, ty = y / 256;
  const n = fractal(tx * 5, ty * 5) * (1 - tx) * (1 - ty)
    + fractal((tx - 1) * 5, ty * 5) * tx * (1 - ty)
    + fractal(tx * 5, (ty - 1) * 5) * (1 - tx) * ty
    + fractal((tx - 1) * 5, (ty - 1) * 5) * tx * ty;
  return [1, 1, 1, smooth(clamp((n - 0.25) * 2))];
});
// A damaged exposure: discontinuous planes of light, sunken sockets, no
// outlined head or mouth. Displacement and erosion are baked into the pixels.
await plate("apparition.webp", 320, 448, (px, py) => {
  const warp = fractal(px / 37, py / 61);
  const x = (px - 160) / 115 + (warp - 0.5) * 0.16;
  const y = (py - 208) / 190;
  const g = (cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
  const skull = g(-0.06, -0.24, 0.57, 0.69);
  let light = 0.41 * skull + 0.3 * g(-0.27, -0.57, 0.29, 0.2)
    + 0.33 * g(-0.28, 0.08, 0.12, 0.3) + 0.17 * g(0.33, 0.12, 0.11, 0.32)
    + 0.22 * g(0.025, -0.015, 0.055, 0.31);
  light -= 0.67 * g(-0.23, -0.25, 0.19, 0.105)
    + 0.63 * g(0.235, -0.21, 0.185, 0.13);
  const erosion = smooth(clamp((fractal(px / 47, py / 71) - 0.22) * 2.3));
  const grit = 0.68 + 0.32 * hash(px, py);
  const alpha = clamp(light * erosion * grit * 1.9) * (1 - smooth(clamp((y - 0.15) / 0.65)));
  return [0.66, 0.7, 0.64, alpha];
});
console.log("Generated grain.webp, mist.webp and apparition.webp (seed 17).");
