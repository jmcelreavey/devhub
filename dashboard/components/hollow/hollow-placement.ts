/** Geometry is read only when a creature opens or the page layout changes. */
export const HOLLOW_MASKED_SURFACES =
  "a, button, input, textarea, select, label, [role='button'], [role='tab'], [role='progressbar'], [role='dialog'], [role='menu'], .terminal-dock, .cm-editor, .xterm, .monaco-editor, .bn-root, .accent-picker-pop, .task-row, .hub-card, .card, .react-grid-item";
export const HOLLOW_BLOCKED = `${HOLLOW_MASKED_SURFACES}, nav, header, h1, h2, h3, h4, p, li, .hub-topbar`;

export interface HollowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Bake subtraction into alpha for identical WebKit/Chromium masking. The
 * mist gets a broad falloff and an oval envelope inside the main viewport;
 * its moving plates must never reveal the rectangular content cutouts. */
export function hollowContentMask(rects: readonly HollowRect[], width: number, height: number, room?: HollowRect): string {
  const holes = (padding: number) => rects.map(r =>
    `<rect x="${r.left - padding}" y="${r.top - padding}" width="${r.right - r.left + padding * 2}" height="${r.bottom - r.top + padding * 2}" fill="black"/>`).join("");
  const roomWidth = room ? room.right - room.left : 0;
  const roomHeight = room ? room.bottom - room.top : 0;
  const envelope = room ? `<radialGradient id="murk" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"
    gradientTransform="translate(${room.left + roomWidth * .56} ${room.top + roomHeight * .55}) scale(${roomWidth * .44} ${roomHeight * .45})">
    <stop stop-color="white"/><stop offset=".4" stop-color="white" stop-opacity=".85"/>
    <stop offset=".7" stop-color="white" stop-opacity=".3"/><stop offset=".94" stop-color="white" stop-opacity="0"/>
  </radialGradient>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      ${envelope}
      <filter id="feather" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feGaussianBlur stdDeviation="${room ? 18 : 6}"/></filter>
      <mask id="readable" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="white"/>
        <g filter="url(#feather)">${holes(room ? 56 : 14)}</g>
        ${holes(2)}
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="${room ? "url(#murk)" : "white"}" mask="url(#readable)"/>
  </svg>`;
}

export function hollowSlotFits(
  box: HollowRect,
  obstacles: readonly HollowRect[],
  sample: (x: number, y: number) => Element | null,
): boolean {
  if (obstacles.some((r) => box.left < r.right + 10 && box.right > r.left - 10
    && box.top < r.bottom + 10 && box.bottom > r.top - 10)) return false;
  const points = [
    [box.left, box.top], [box.right, box.top],
    [box.left, box.bottom], [box.right, box.bottom],
    [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
  ];
  return points.every(([x, y]) => {
    const el = sample(x, y);
    if (!el || el.closest(HOLLOW_BLOCKED)) return false;
    return ![...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim());
  });
}

function contentAt(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find((el) => !el.closest(".hollow-fx")) ?? null;
}

export function occupiedRects(surfaces = HOLLOW_BLOCKED): HollowRect[] {
  const rects: HollowRect[] = [...document.querySelectorAll(surfaces)]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
  // Text can live in unclassified spans. Rect intersection catches even a
  // short link between the five hit-test points, and every visible text run.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim() || node.parentElement?.closest(".hollow-fx, script, style")) continue;
    range.selectNodeContents(node);
    rects.push(...range.getClientRects());
  }
  return rects;
}

export function quietHollowSlots(count: number, stable = false): Array<{ x: number; y: number }> {
  if (document.querySelector(".boot-screen")) return [];
  const width = window.innerWidth, height = window.innerHeight;
  const obstacles = occupiedRects();
  const spots = [0.91, 0.76, 0.6, 0.43].flatMap((x) =>
    [0.88, 0.74, 0.59, 0.95].map((y) => ({ x: width * x, y: height * y })));
  if (!stable) {
    const offset = Math.floor(Math.random() * spots.length);
    spots.push(...spots.splice(0, offset));
  }
  const found: Array<{ x: number; y: number }> = [];
  for (const point of spots) {
    // Include the iris halos as well as the visible sockets.
    const box = { left: point.x - 76, right: point.x + 76, top: point.y - 40, bottom: point.y + 40 };
    if (box.left < 16 || box.right > width - 16 || box.top < 110 || box.bottom > height - 20) continue;
    if (!hollowSlotFits(box, obstacles, contentAt)) continue;
    if (found.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 200)) continue;
    found.push(point);
    if (found.length === count) break;
  }
  return found;
}

export function quietSpiderColumn(): number | null {
  if (document.querySelector(".boot-screen")) return null;
  const obstacles = occupiedRects();
  // Include the thread, defocused legs and their entire descent.
  for (const fraction of [0.94, 0.85, 0.75, 0.66, 0.56]) {
    const x = window.innerWidth * fraction;
    if (hollowSlotFits({ left: x - 56, right: x + 56, top: 82, bottom: 262 }, obstacles, contentAt)) return x;
  }
  return null;
}

export function quietApparitionSlot(): { x: number; y: number } | null {
  if (document.querySelector(".boot-screen")) return null;
  const width = Math.min(320, window.innerWidth * 0.36);
  const height = 448;
  const obstacles = occupiedRects();
  for (const x of [window.innerWidth - width - 24, window.innerWidth * 0.58, 260]) {
    const y = window.innerHeight - height - 24;
    const box = { left: x, right: x + width, top: y, bottom: y + height };
    if (y > 110 && hollowSlotFits(box, obstacles, contentAt)) return { x, y };
  }
  return null;
}
