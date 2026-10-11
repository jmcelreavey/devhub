// Chroma-key a flat-magenta concept sheet to clean RGBA without pink fringes.
//
// The sheets are JPEGs, so the key colour is noisy and edge pixels are a blend
// of sprite and magenta (plus 4:2:0 chroma bleed). A plain "delete near-magenta"
// leaves a pink halo. This does it in three steps:
//   1. background = near-key pixels reachable from the sheet border (plus pure
//      enclosed pockets), so magenta-ish *foreground* (plasma orb, potion) survives;
//   2. "solid" = pixels clearly far from the key; every remaining pixel is a
//      key/foreground mixture, so its foreground colour F is taken from the
//      nearest solid pixel and alpha is solved as the projection onto K→F;
//   3. the output colour of mixture pixels is un-mixed (or snapped to F near
//      the silhouette), which removes the magenta contribution entirely.

const DEFAULT_BG_NEAR = 70; // distance to key that is certainly background (after noise)
const DEFAULT_SOLID_FAR = 150; // distance to key that is certainly foreground
const DEFAULT_POCKET_MEAN = 26; // enclosed pocket must be this close to pure key on average
const POCKET_MIN_PX = 10;
const DEFAULT_SEARCH_RADIUS = 28; // how far to look for a solid colour to unmix against

/** Median RGB of the four corner blocks — sprites never touch the sheet corners. */
export function estimateKey(rgb, w, h) {
  const bs = 24;
  const rs = [];
  const gs = [];
  const bl = [];
  for (const [x0, y0] of [[0, 0], [w - bs, 0], [0, h - bs], [w - bs, h - bs]]) {
    for (let y = y0; y < y0 + bs; y++) {
      for (let x = x0; x < x0 + bs; x++) {
        const i = (y * w + x) * 3;
        rs.push(rgb[i]);
        gs.push(rgb[i + 1]);
        bl.push(rgb[i + 2]);
      }
    }
  }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bl)];
}

/**
 * @param {Uint8Array|Buffer} rgb  w*h*3 interleaved
 * @returns {{ rgba: Uint8Array, key: number[] }}
 */
export function keyToRgba(rgb, w, h, opts = {}) {
  const BG_NEAR = opts.bgNear ?? DEFAULT_BG_NEAR;
  const SOLID_FAR = opts.solidFar ?? DEFAULT_SOLID_FAR;
  const SEARCH_RADIUS = opts.searchRadius ?? DEFAULT_SEARCH_RADIUS;
  const POCKET_NEAR = opts.pocketNear ?? BG_NEAR * 0.55;
  const POCKET_MEAN = opts.pocketMean ?? DEFAULT_POCKET_MEAN;
  const sealedGlass = opts.sealedGlass === true; // enclosed key-tinted regions become translucent
  const key = opts.key ?? estimateKey(rgb, w, h);
  const [kr, kg, kb] = key;
  const n = w * h;
  const dist = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const dr = rgb[i] - kr;
    const dg = rgb[i + 1] - kg;
    const db = rgb[i + 2] - kb;
    dist[p] = Math.sqrt(dr * dr + dg * dg + db * db);
  }

  // 1. background: flood from the border over near-key pixels.
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p) => {
    if (!bg[p] && dist[p] < BG_NEAR) {
      bg[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }
  // Enclosed pockets of (nearly) pure key — gaps between legs, ring sparkles.
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (bg[s] || seen[s] || dist[s] >= POCKET_NEAR) continue;
    const comp = [];
    let sum = 0;
    sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      comp.push(p);
      sum += dist[p];
      const x = p % w;
      const tryPush = (q) => {
        if (!seen[q] && !bg[q] && dist[q] < POCKET_NEAR) { seen[q] = 1; stack[sp++] = q; }
      };
      if (x > 0) tryPush(p - 1);
      if (x < w - 1) tryPush(p + 1);
      if (p >= w) tryPush(p - w);
      if (p < n - w) tryPush(p + w);
    }
    if (comp.length >= POCKET_MIN_PX && sum / comp.length < POCKET_MEAN) {
      for (const p of comp) bg[p] = 1;
    }
  }

  // 2. nearest solid colour for every non-solid pixel (multi-source BFS).
  const solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) solid[p] = !bg[p] && dist[p] >= SOLID_FAR ? 1 : 0;
  const nearIdx = new Int32Array(n).fill(-1);
  const nearD = new Uint8Array(n);
  let queue = [];
  for (let p = 0; p < n; p++) {
    if (solid[p]) { nearIdx[p] = p; queue.push(p); }
  }
  for (let r = 1; r <= SEARCH_RADIUS && queue.length; r++) {
    const next = [];
    for (const p of queue) {
      const x = p % w;
      const src = nearIdx[p];
      const visit = (q) => {
        if (nearIdx[q] === -1 && !bg[q]) { nearIdx[q] = src; nearD[q] = r; next.push(q); }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
    queue = next;
  }

  // Geodesic reach from the background through non-solid pixels: only those are
  // key/foreground mixtures. A non-solid pixel sealed inside a solid rim (the
  // pink potion inside its gold badge) is genuine foreground and stays opaque.
  const reach = new Uint8Array(n);
  {
    let q = [];
    for (let p = 0; p < n; p++) if (bg[p]) q.push(p);
    for (let d = 1; d <= 40 && q.length; d++) {
      const next = [];
      for (const p of q) {
        const x = p % w;
        const visit = (m) => {
          if (!bg[m] && !solid[m] && !reach[m]) { reach[m] = 1; next.push(m); }
        };
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (p >= w) visit(p - w);
        if (p < n - w) visit(p + w);
      }
      q = next;
    }
  }

  // 3. alpha + un-mixed colour.
  const out = new Uint8Array(n * 4);
  for (let p = 0; p < n; p++) {
    const i3 = p * 3;
    const o = p * 4;
    if (bg[p]) continue; // fully transparent
    if (!solid[p] && !reach[p] && sealedGlass && nearIdx[p] !== -1) {
      // Sealed pocket tinted by the key seen through glass (the turtle's time
      // bubble): fade alpha with distance from the key and take the rim colour.
      const a = Math.min(1, Math.max(0, (dist[p] - 20) / (SOLID_FAR - 20)));
      if (a < 0.06) continue;
      const sidx = nearIdx[p] * 3;
      out[o] = rgb[sidx]; out[o + 1] = rgb[sidx + 1]; out[o + 2] = rgb[sidx + 2];
      out[o + 3] = Math.round(a * 255);
      continue;
    }
    if (solid[p] || !reach[p]) {
      out[o] = rgb[i3]; out[o + 1] = rgb[i3 + 1]; out[o + 2] = rgb[i3 + 2]; out[o + 3] = 255;
      continue;
    }
    const src = nearIdx[p];
    if (src === -1) {
      // Isolated faint pixel with no solid neighbour: key it by distance only.
      const a = Math.min(1, Math.max(0, (dist[p] - 30) / 90));
      if (a <= 0.06) continue;
      const g = rgb[i3 + 1];
      out[o] = Math.min(rgb[i3], g + 20); out[o + 1] = g; out[o + 2] = Math.min(rgb[i3 + 2], g + 20);
      out[o + 3] = Math.round(a * 255);
      continue;
    }
    const fr = rgb[src * 3], fg = rgb[src * 3 + 1], fb = rgb[src * 3 + 2];
    const ux = fr - kr, uy = fg - kg, uz = fb - kb;
    const uu = ux * ux + uy * uy + uz * uz;
    let a = ((rgb[i3] - kr) * ux + (rgb[i3 + 1] - kg) * uy + (rgb[i3 + 2] - kb) * uz) / uu;
    if (uu < 80 * 80) a = 1; // foreground itself is key-coloured: cannot unmix
    a = Math.min(1, Math.max(0, a));
    if (a < 0.06) continue;
    let r, g, b;
    if (a > 0.45 && uu >= 80 * 80) {
      // Un-mix: p = aF + (1-a)K  =>  F = (p - (1-a)K)/a, clamped.
      r = (rgb[i3] - (1 - a) * kr) / a;
      g = (rgb[i3 + 1] - (1 - a) * kg) / a;
      b = (rgb[i3 + 2] - (1 - a) * kb) / a;
      // Blend toward the sampled solid colour near the silhouette so JPEG
      // ringing in the estimate can't re-introduce a tint.
      const t = Math.min(1, nearD[p] / 3) * 0.5;
      r = r * (1 - t) + fr * t; g = g * (1 - t) + fg * t; b = b * (1 - t) + fb * t;
    } else {
      r = fr; g = fg; b = fb;
    }
    out[o] = Math.max(0, Math.min(255, Math.round(r)));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    out[o + 3] = Math.round(a * 255);
  }

  // Drop JPEG speckle: tiny, faint islands that survived the key.
  {
    const lab = new Uint8Array(n);
    const st = new Int32Array(n);
    for (let s0 = 0; s0 < n; s0++) {
      if (lab[s0] || out[s0 * 4 + 3] === 0) continue;
      let top = 0, area = 0, maxA = 0;
      const members = [];
      st[top++] = s0; lab[s0] = 1;
      while (top > 0) {
        const p = st[--top];
        members.push(p);
        area++;
        if (out[p * 4 + 3] > maxA) maxA = out[p * 4 + 3];
        const x = p % w;
        const tp = (m) => { if (!lab[m] && out[m * 4 + 3] !== 0) { lab[m] = 1; st[top++] = m; } };
        if (x > 0) tp(p - 1);
        if (x < w - 1) tp(p + 1);
        if (p >= w) tp(p - w);
        if (p < n - w) tp(p + w);
      }
      if (area < 10 && maxA < 200) for (const p of members) out[p * 4 + 3] = 0;
    }
  }

  // Edge despill. JPEG 4:2:0 chroma bleeds the key colour 1-3px into the
  // sprite, so silhouette pixels are tinted pink/purple even when opaque.
  // Re-colour every non-"deep" pixel that is more magenta than the nearest
  // interior colour: keep its own luminance, take the interior chroma.
  despillEdges(out, w, h);

  return { rgba: out, key };
}

function despillEdges(out, w, h) {
  const n = w * h;
  // deep = opaque and at least DEEP px from any non-opaque pixel (4-neighbour erosion).
  const DEEP = 4;
  let cur = new Uint8Array(n);
  for (let p = 0; p < n; p++) cur[p] = out[p * 4 + 3] === 255 ? 1 : 0;
  for (let it = 0; it < DEEP; it++) {
    const nx = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (cur[p] && cur[p - 1] && cur[p + 1] && cur[p - w] && cur[p + w]) nx[p] = 1;
      }
    }
    cur = nx;
  }
  const src = new Int32Array(n).fill(-1);
  let q = [];
  for (let p = 0; p < n; p++) if (cur[p]) { src[p] = p; q.push(p); }
  for (let r = 1; r <= 7 && q.length; r++) {
    const next = [];
    for (const p of q) {
      const x = p % w;
      const s0 = src[p];
      const visit = (m) => {
        if (src[m] === -1 && out[m * 4 + 3] !== 0) { src[m] = s0; next.push(m); }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (p >= w) visit(p - w);
      if (p < n - w) visit(p + w);
    }
    q = next;
  }
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (out[o + 3] === 0 || cur[p]) continue;
    const r = out[o], g = out[o + 1], b = out[o + 2];
    const spill = Math.min(r, b) - g;
    if (spill <= 10) continue;
    const s0 = src[p];
    let tr, tg, tb;
    if (s0 === -1) {
      // Thin feature, no interior to learn from: just cap the magenta.
      const cap = g + 8;
      tr = Math.min(r, cap); tg = g; tb = Math.min(b, cap);
    } else {
      const so = s0 * 4;
      const sr = out[so], sg = out[so + 1], sb = out[so + 2];
      const spillIn = Math.min(sr, sb) - sg;
      if (spill <= spillIn + 8) continue;
      const yP = 0.299 * r + 0.587 * g + 0.114 * b;
      const yS = 0.299 * sr + 0.587 * sg + 0.114 * sb;
      tr = yP + (sr - yS); tg = yP + (sg - yS); tb = yP + (sb - yS);
    }
    out[o] = Math.max(0, Math.min(255, Math.round(r * 0.1 + tr * 0.9)));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(g * 0.1 + tg * 0.9)));
    out[o + 2] = Math.max(0, Math.min(255, Math.round(b * 0.1 + tb * 0.9)));
  }
}

/** Swap the hue of translucent aura pixels (alpha < maxAlpha) toward `tint`. */
export function tintAura(rgba, w, h, tint, strength = 0.8, maxAlpha = 235, region = {}) {
  const x0 = region.x0 ?? 0;
  const x1 = region.x1 ?? w;
  for (let p = 0; p < w * h; p++) {
    const px = p % w;
    if (px < x0 || px >= x1) continue;
    const o = p * 4;
    const a = rgba[o + 3];
    if (a === 0 || a >= maxAlpha) continue;
    const y = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
    const k = 0.7 + 0.5 * y; // keep bright cores brighter than the halo
    for (let c = 0; c < 3; c++) {
      const target = Math.min(255, tint[c] * k);
      rgba[o + c] = Math.round(rgba[o + c] * (1 - strength) + target * strength);
    }
  }
}


/** Share of semi/edge pixels that are still "magenta-ish" — the pink-halo metric. */
export function fringeScore(rgba, w, h) {
  let edge = 0;
  let pink = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      const a = rgba[o + 3];
      if (a === 0) continue;
      const touches = a < 255 || rgba[o - 4 + 3] === 0 || rgba[o + 4 + 3] === 0 || rgba[o - w * 4 + 3] === 0 || rgba[o + w * 4 + 3] === 0;
      if (!touches) continue;
      edge++;
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      if (r > 150 && b > 150 && Math.min(r, b) - g > 70) pink++;
    }
  }
  return edge === 0 ? 0 : pink / edge;
}

/** Re-hue pixels matching `when` inside a column range (used to repair ambiguous glows). */
export function recolor(rgba, w, h, { x0 = 0, x1 = w, when, to }) {
  for (let p = 0; p < w * h; p++) {
    const px = p % w;
    if (px < x0 || px >= x1) continue;
    const o = p * 4;
    if (rgba[o + 3] === 0) continue;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    if (!when(r, g, b)) continue;
    const [nr, ng, nb] = to(r, g, b);
    rgba[o] = Math.max(0, Math.min(255, Math.round(nr)));
    rgba[o + 1] = Math.max(0, Math.min(255, Math.round(ng)));
    rgba[o + 2] = Math.max(0, Math.min(255, Math.round(nb)));
  }
}

/**
 * Remove sealed slivers of key colour that survive the flood fill (gaps in hair
 * strands). Hot-magenta pixels go transparent; their weaker neighbours (the
 * mixed edge) follow, so no purple outline is left around the hole.
 */
export function purgeMagenta(rgba, w, h) {
  const hot = (o) => {
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    return rgba[o + 3] > 0 && r > 160 && b > 160 && g < Math.min(r, b) - 85;
  };
  const warm = (o) => {
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    return rgba[o + 3] > 0 && r > 110 && b > 120 && g < Math.min(r, b) - 40;
  };
  const kill = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (hot(p * 4)) kill[p] = 1;
  // grow into warm neighbours (two rings)
  for (let ring = 0; ring < 2; ring++) {
    const add = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (kill[p] || !warm(p * 4)) continue;
        if (kill[p - 1] || kill[p + 1] || kill[p - w] || kill[p + w]) add.push(p);
      }
    }
    for (const p of add) kill[p] = 1;
  }
  for (let p = 0; p < w * h; p++) if (kill[p]) rgba[p * 4 + 3] = 0;
}
