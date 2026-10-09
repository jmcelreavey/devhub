import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Pass a local Sharp installation; the artwork itself has no runtime dependencies.
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.dirname(fileURLToPath(import.meta.url));

// Graphite Neon only. `mod` is the neutral grey the plug-in modules use; `ink` is the wordmark.
const palettes = {
  dark: { bg: '#111416', ink: '#ebeff3', accent: '#9ed84a', mod: '#9aa6b2', muted: '#a5b0ba', border: '#37414b' },
  light: { bg: '#f7f8f9', ink: '#1f2a33', accent: '#4c840c', mod: '#46545f', muted: '#4f6171', border: '#cfd8df' },
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const n = (v) => +v.toFixed(2);
const rect = (x, y, w, h, r, fill) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${r ? ` rx="${r}"` : ''} fill="${fill}"/>`;

// Inward offset of a simple polygon (axis-aligned and 45 degree edges are all we use).
function offsetPoly(pts, d) {
  const area = pts.reduce((s, [x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    return s + (x * y2 - x2 * y);
  }, 0);
  const sign = area > 0 ? 1 : -1; // screen coords: positive area is clockwise
  const lines = pts.map(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = (-(y2 - y1) / len) * sign;
    const ny = ((x2 - x1) / len) * sign;
    return { px: x1 + nx * d, py: y1 + ny * d, dx: x2 - x1, dy: y2 - y1 };
  });
  return lines.map((b, i) => {
    const a = lines[(i + lines.length - 1) % lines.length];
    const cross = a.dx * b.dy - a.dy * b.dx;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / cross;
    return [a.px + a.dx * t, a.py + a.dy * t];
  });
}
// Convex corners get radius r; concave notch corners stay crisp, like a socket.
const softPoly = (pts, r, fill) => {
  const o = offsetPoly(pts, r).map(([x, y]) => `${n(x)} ${n(y)}`);
  return `<path d="M${o.join('L')}Z" fill="${fill}" stroke="${fill}" stroke-width="${r * 2}" stroke-linejoin="round"/>`;
};
const rotated = (angle, body) => (angle ? `<g transform="rotate(${angle} 32 32)">${body}</g>` : body);

// ---------------------------------------------------------------------------
// Marks. Each lives in a 64 x 64 box, content inside 3..61, centred on 32,32.
// `favicon` is separate pixel-aligned artwork for a 16 x 16 box.
// ---------------------------------------------------------------------------
const marks = [
  {
    id: 'hub', name: 'Hub', kind: 'Hub refinement',
    idea: 'Four modules docked on a lime core. The literal mark, drawn tight.',
    draw: (p) =>
      [[24, 3], [3, 24], [45, 24], [24, 45]].map(([x, y]) => rect(x, y, 16, 16, 4, p.mod)).join('') +
      rect(22, 22, 20, 20, 5, p.accent),
    favicon: (p) =>
      [[6, 1, 4, 3], [1, 6, 3, 4], [12, 6, 3, 4], [6, 12, 4, 3]].map(([x, y, w, h]) => rect(x, y, w, h, 0, p.mod)).join('') +
      rect(5, 5, 6, 6, 0, p.accent),
  },
  {
    id: 'socket', name: 'Socket', kind: 'Hub refinement',
    idea: 'Each module has a slot. The lime core carries a plug into every one.',
    draw: (p) => {
      // One module with its slot on the right of the core, rotated for the other three sides.
      const module =
        `<path d="M46 23H57A4 4 0 0 1 61 27V37A4 4 0 0 1 57 41H46A2 2 0 0 1 44 39V36H49V28H44V25A2 2 0 0 1 46 23Z" fill="${p.mod}"/>`;
      const plug = rect(41, 29.5, 6, 5, 0, p.accent);
      return [0, 90, 180, 270].map((a) => rotated(a, module + plug)).join('') + rect(22, 22, 20, 20, 5, p.accent);
    },
    // Slots and plugs are under 1px at 16px; the stubs merged into a blob, so Socket ships the plain Hub favicon.
    favicon: (p) =>
      [[6, 1, 4, 3], [1, 6, 3, 4], [12, 6, 3, 4], [6, 12, 4, 3]].map(([x, y, w, h]) => rect(x, y, w, h, 0, p.mod)).join('') +
      rect(5, 5, 6, 6, 0, p.accent),
  },
  {
    id: 'bus', name: 'Bus', kind: 'Hub refinement',
    idea: 'A lime cross runs through the hub. The modules sit on its four ends.',
    draw: (p) =>
      rect(28, 3, 8, 58, 0, p.accent) + rect(3, 28, 58, 8, 0, p.accent) +
      [[22, 3, 20, 14], [3, 22, 14, 20], [47, 22, 14, 20], [22, 47, 20, 14]].map(([x, y, w, h]) => rect(x, y, w, h, 3.5, p.mod)).join('') +
      rect(23, 23, 18, 18, 4, p.accent),
    favicon: (p) =>
      [[6, 1, 4, 3], [1, 6, 3, 4], [12, 6, 3, 4], [6, 12, 4, 3]].map(([x, y, w, h]) => rect(x, y, w, h, 0, p.mod)).join('') +
      [[7, 4, 2, 2], [4, 7, 2, 2], [10, 7, 2, 2], [7, 10, 2, 2]].map(([x, y, w, h]) => rect(x, y, w, h, 0, p.accent)).join('') +
      rect(6, 6, 4, 4, 0, p.accent),
  },
  {
    id: 'folio-quad', name: 'Folio Quad', kind: 'Folio + Hub',
    idea: 'Folio\'s silhouette, split into four modules around a lime core. The cut corners are the fold.',
    draw: (p) =>
      softPoly([[4, 4], [30, 4], [30, 20], [20, 20], [20, 30], [4, 30]], 2, p.mod) +
      softPoly([[34, 4], [48, 4], [60, 16], [60, 30], [44, 30], [44, 20], [34, 20]], 2, p.mod) +
      softPoly([[4, 34], [20, 34], [20, 44], [30, 44], [30, 60], [16, 60], [4, 48]], 2, p.mod) +
      softPoly([[44, 34], [60, 34], [60, 60], [34, 60], [34, 44], [44, 44]], 2, p.mod) +
      rect(23, 23, 18, 18, 4, p.accent),
    // Modules 6px, 4px channel, 2px notch off each inner corner so the 6px core keeps a 1px moat.
    favicon: (p) =>
      `<path d="M0 0H6V4H4V6H0Z" fill="${p.mod}"/>` +
      `<path d="M10 0H14L16 2V6H12V4H10Z" fill="${p.mod}"/>` +
      `<path d="M0 10H4V12H6V16H2L0 14Z" fill="${p.mod}"/>` +
      `<path d="M12 10H16V16H10V12H12Z" fill="${p.mod}"/>` +
      rect(5, 5, 6, 6, 0, p.accent),
  },
  {
    id: 'shift-dock', name: 'Shift Dock', kind: 'Shift + Hub',
    idea: 'Shift\'s offset middle row, ending in a lime hub that has docked in the stack.',
    draw: (p) =>
      rect(4, 5, 40, 12, 6, p.mod) + rect(4, 47, 40, 12, 6, p.mod) +
      rect(4, 26, 28, 12, 6, p.mod) + rect(36, 21, 22, 22, 5, p.accent),
    favicon: (p) =>
      rect(1, 1, 10, 3, 0, p.mod) + rect(1, 12, 10, 3, 0, p.mod) + rect(1, 6, 6, 4, 0, p.mod) +
      rect(9, 5, 6, 6, 0, p.accent),
  },
  {
    id: 'pinwheel', name: 'Pinwheel', kind: 'Abstract',
    idea: 'Four modules turn around the core. A hub without the plus sign.',
    draw: (p) =>
      rect(3, 3, 37, 18, 4, p.mod) + rect(43, 3, 18, 37, 4, p.mod) +
      rect(24, 43, 37, 18, 4, p.mod) + rect(3, 24, 18, 37, 4, p.mod) +
      rect(24, 24, 16, 16, 4, p.accent),
    favicon: (p) =>
      rect(1, 1, 9, 4, 0, p.mod) + rect(11, 1, 4, 9, 0, p.mod) +
      rect(6, 11, 9, 4, 0, p.mod) + rect(1, 6, 4, 9, 0, p.mod) +
      rect(6, 6, 4, 4, 0, p.accent),
  },
  {
    id: 'shift', name: 'Shift', kind: 'Abstract',
    idea: 'Refined Shift: three bars on the hub\'s grid, the middle one moved.',
    draw: (p) => rect(4, 5, 40, 14, 7, p.mod) + rect(20, 25, 40, 14, 7, p.accent) + rect(4, 45, 40, 14, 7, p.mod),
    favicon: (p) => rect(1, 1, 10, 4, 0, p.mod) + rect(5, 6, 10, 4, 0, p.accent) + rect(1, 11, 10, 4, 0, p.mod),
  },
];

// ---------------------------------------------------------------------------
// Wordmark: original geometric lettering built from strokes on a 48 unit cap height.
// No font files, no text nodes.
// ---------------------------------------------------------------------------
const WORDMARK_WIDTH = 250;
function wordmark(p) {
  const stroke = `fill="none" stroke="${p.ink}" stroke-width="8"`;
  const glyph = (x, body) => `<g transform="translate(${x} 0)">${body}</g>`;
  return [
    glyph(0, `<path ${stroke} stroke-linejoin="miter" d="M4 4H16A20 20 0 0 1 16 44H4Z"/>`), // D
    glyph(46, `<path ${stroke} d="M4 30H32A14 14 0 1 0 28 40"/>`), // e
    glyph(85, `<path fill="${p.ink}" d="M0 12H9L18 37L27 12H36L22.5 48H13.5Z"/>`), // v
    glyph(130, `<path ${stroke} d="M4 0V48M32 0V48M4 24H32"/>`), // H
    glyph(172, `<path ${stroke} d="M4 12V30A14 14 0 0 0 32 30M32 12V48"/>`), // u
    glyph(214, `<path ${stroke} d="M4 0V48"/><circle cx="18" cy="30" r="14" ${stroke}/>`), // b
  ].join('');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
function svg(w, h, title, body, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${extra} role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
}
// Apple-style continuous corner: a superellipse, not a plain rounded rectangle.
function squircle(cx, cy, half, exponent = 5, steps = 360) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push(`${n(cx + half * Math.sign(c) * Math.abs(c) ** (2 / exponent))} ${n(cy + half * Math.sign(s) * Math.abs(s) ** (2 / exponent))}`);
  }
  return `M${pts.join('L')}Z`;
}
async function save(dir, name, source, size) {
  await fs.writeFile(path.join(dir, name + '.svg'), source);
  let pipeline = sharp(Buffer.from(source));
  if (size) pipeline = pipeline.resize(size, size);
  await pipeline.png().toFile(path.join(dir, name + '.png'));
}
const text = (x, y, value, size, fill, weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${value}</text>`;

const lockupBody = (mark, p) =>
  `<g transform="translate(8 8)">${mark}</g><g transform="translate(92 16)">${wordmark(p)}</g>`;
const LOCKUP_W = 92 + WORDMARK_WIDTH + 12;
const iconBody = (mark, p) =>
  `<path d="${squircle(512, 512, 412)}" fill="${p.bg}" stroke="${p.border}" stroke-width="2"/>` +
  `<g transform="translate(512 512) scale(8.6) translate(-32 -32)">${mark}</g>`;

// Native-size raster of the 16px favicon, then nearest-neighbour 8x so each pixel is inspectable.
async function faviconRasters(source) {
  const native = await sharp(Buffer.from(source)).png().toBuffer();
  const zoomed = await sharp(native).resize(128, 128, { kernel: 'nearest' }).png().toBuffer();
  return { native, zoomed };
}
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

const ROW = 262;
const HEAD = 150;
const sheet = [];
sheet.push(`<rect width="1800" height="${HEAD + marks.length * ROW + 60}" fill="#111416"/>`);
sheet.push(text(56, 70, 'DevHub / logo round 2 / Sonnet', 36, '#ebeff3', 600));
sheet.push(text(56, 104, 'Hub with plug-in slots, refined and combined with Folio and Shift. Graphite Neon only. Every favicon is a native 16px raster with an 8x pixel zoom beside it.', 16, '#a5b0ba'));

const faviconChecks = [];
for (const [i, m] of marks.entries()) {
  const dir = path.join(root, m.id);
  await fs.mkdir(dir, { recursive: true });
  const y = HEAD + i * ROW;
  sheet.push(text(56, y + 28, `${i + 1}. ${m.name}`, 24, '#ebeff3', 600));
  sheet.push(text(56 + 232, y + 28, `${m.kind}  ·  ${m.idea}`, 15, '#a5b0ba'));
  for (const [mode, p] of Object.entries(palettes)) {
    const mark = m.draw(p);
    const fav = m.favicon(p);
    const title = `DevHub / ${m.name}`;
    await save(dir, `mark-${mode}`, svg(64, 64, title, mark));
    const lockup = lockupBody(mark, p);
    await save(dir, `lockup-${mode}`, svg(LOCKUP_W, 80, `${title} / ${mode}`, lockup));
    const icon = iconBody(mark, p);
    await save(dir, `app-icon-${mode}`, svg(1024, 1024, `${title} / macOS ${mode}`, icon));
    const favSvg = svg(16, 16, `${title} / 16px ${mode}`, fav);
    await save(dir, `favicon-${mode}`, favSvg);
    const { zoomed, native } = await faviconRasters(favSvg);
    await fs.writeFile(path.join(dir, `favicon-${mode}-8x.png`), zoomed);

    // Contact sheet panel: dark on the left half, light on the right.
    const x = mode === 'dark' ? 56 : 920;
    sheet.push(`<rect x="${x}" y="${y + 44}" width="824" height="196" fill="${p.bg}" stroke="${p.border}"/>`);
    sheet.push(`<g transform="translate(${x + 20} ${y + 70}) scale(1.5)">${mark}</g>`);
    sheet.push(`<g transform="translate(${x + 130} ${y + 78}) scale(1.05)">${lockup}</g>`);
    sheet.push(`<g transform="translate(${x + 545} ${y + 66}) scale(.14)">${icon}</g>`);
    sheet.push(`<image x="${x + 700}" y="${y + 60}" width="16" height="16" href="${b64(native)}"/>`);
    sheet.push(`<image x="${x + 690}" y="${y + 100}" width="128" height="128" href="${b64(zoomed)}"/>`);
    sheet.push(text(x + 24, y + 226, mode === 'dark' ? 'Dark' : 'Light', 12, p.muted));
    sheet.push(text(x + 724, y + 90, '16px', 11, p.muted, 400, 'middle'));
    faviconChecks.push({ id: m.id, mode, zoomed, p });
  }
}
sheet.push(text(56, HEAD + marks.length * ROW + 30, 'Icon tiles are 1024px studies drawn at 16%. Nothing here replaces an installed app icon.', 14, '#a5b0ba'));
await fs.writeFile(
  path.join(root, 'contact-sheet.svg'),
  svg(1800, HEAD + marks.length * ROW + 60, 'DevHub logo round 2 / Sonnet', sheet.join('')),
);
await sharp(Buffer.from(svg(1800, HEAD + marks.length * ROW + 60, 'DevHub logo round 2 / Sonnet', sheet.join(''))))
  .png().toFile(path.join(root, 'contact-sheet.png'));
console.log(`Rendered ${marks.length} marks and the contact sheet.`);
