export const RUNTIME_THEME_EDITING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .terminal-wterm, .cm-editor, .monaco-editor, .bn-root';
export const RUNTIME_THEME_PROTECTED = `${RUNTIME_THEME_EDITING}, .boot-screen, .page-loading, .inline-loading, .terminal-dock, [role="dialog"], [role="menu"], .toast, .command-palette, iframe`;
export const RUNTIME_THEME_BLOCKED = `${RUNTIME_THEME_PROTECTED}, a, button, label, [role="button"], [role="tab"], [role="progressbar"], .accent-picker-pop, .task-row, .hub-card, .card, .react-grid-item, nav, header, h1, h2, h3, h4, p, li, .hub-topbar`;

const surfaces = 'a, button, label, [role="button"], [role="tab"], [role="progressbar"], .accent-picker-pop, .task-row, .hub-card, .card, .react-grid-item';
const owned = '[data-runtime-theme-root], [data-runtime-theme-decoration]';
const ignored = `${owned}, script, style, link, noscript, template`;
const moving = '.page-wrapper, .hub-page, .react-grid-item, .workspace-tab-panel';
const maximumNodes = 4096;
const maximumRects = 512;
const maximumBytes = 16 * 1024;

export type RuntimeSceneRect = [number, number, number, number];

export interface RuntimeSceneLayout {
  room: RuntimeSceneRect;
  occupied: RuntimeSceneRect[];
  eyes: number[];
  spiders: number[];
  faces: number[];
}

export interface RuntimeSceneGeometry {
  layout: RuntimeSceneLayout;
  sceneMask: string;
  mistMask: string;
  roomMask: string;
  observed: Set<Element>;
}

export function roundedSceneRect(rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">, width: number, height: number): RuntimeSceneRect | null {
  if (![rect.left, rect.top, rect.right, rect.bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || rect.right <= rect.left || rect.bottom <= rect.top) return null;
  const result: RuntimeSceneRect = [
    Math.max(0, Math.floor(rect.left / 8) * 8),
    Math.max(0, Math.floor(rect.top / 8) * 8),
    Math.min(width, Math.ceil(rect.right / 8) * 8),
    Math.min(height, Math.ceil(rect.bottom / 8) * 8),
  ];
  return result[0] < result[2] && result[1] < result[3] ? result : null;
}

export function addSceneRect(rects: RuntimeSceneRect[], rect: RuntimeSceneRect): boolean {
  const merged: RuntimeSceneRect = [...rect];
  for (let index = 0; index < rects.length;) {
    const other = rects[index];
    if (merged[0] <= other[2] && merged[2] >= other[0] && merged[1] <= other[3] && merged[3] >= other[1]) {
      merged[0] = Math.min(merged[0], other[0]); merged[1] = Math.min(merged[1], other[1]);
      merged[2] = Math.max(merged[2], other[2]); merged[3] = Math.max(merged[3], other[3]);
      rects.splice(index, 1);
      index = 0;
    } else index++;
  }
  rects.push(merged);
  return rects.length <= maximumRects;
}

function maskImage(rects: RuntimeSceneRect[], width: number, height: number, room?: RuntimeSceneRect, mist = false): string {
  const holes = (padding: number) => rects.map(([left, top, right, bottom]) =>
    `<rect x="${left - padding}" y="${top - padding}" width="${right - left + padding * 2}" height="${bottom - top + padding * 2}" fill="black"/>`).join("");
  const [left, top, right, bottom] = room ?? [0, 0, width, height];
  const roomWidth = right - left, roomHeight = bottom - top;
  const fill = mist ? "url(#murk)" : "white";
  const envelope = mist ? `<radialGradient id="murk" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${left + roomWidth * .56} ${top + roomHeight * .55}) scale(${roomWidth * .44} ${roomHeight * .45})"><stop stop-color="white"/><stop offset=".4" stop-color="white" stop-opacity=".85"/><stop offset=".7" stop-color="white" stop-opacity=".3"/><stop offset=".94" stop-color="white" stop-opacity="0"/></radialGradient>` : "";
  const edge = room ? `<linearGradient id="x"><stop stop-color="black"/><stop offset=".04" stop-color="white"/><stop offset=".96" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient><linearGradient id="y" x2="0" y2="1"><stop stop-color="black"/><stop offset=".04" stop-color="white"/><stop offset=".96" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient><mask id="vertical"><rect x="${left}" y="${top}" width="${roomWidth}" height="${roomHeight}" fill="url(#y)"/></mask><mask id="space"><rect x="${left}" y="${top}" width="${roomWidth}" height="${roomHeight}" fill="url(#x)" mask="url(#vertical)"/></mask>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${envelope}${edge}<filter id="feather" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><feGaussianBlur stdDeviation="${mist ? 18 : 6}"/></filter><mask id="readable" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g filter="url(#feather)">${holes(mist ? 56 : 14)}</g>${holes(2)}</mask></defs><g mask="url(#readable)"><rect width="100%" height="100%" fill="${fill}"${room ? ' mask="url(#space)"' : ""}/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function hasText(element: Element): boolean {
  return [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && Boolean(node.nodeValue?.trim()));
}

function slotFits(box: RuntimeSceneRect, obstacles: RuntimeSceneRect[], width: number, height: number): boolean {
  const [left, top, right, bottom] = box;
  if (left < 0 || top < 0 || right > width || bottom > height) return false;
  if (obstacles.some(rect => left < rect[2] + 10 && right > rect[0] - 10 && top < rect[3] + 10 && bottom > rect[1] - 10)) return false;
  return [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]].every(([x, y]) => {
    const element = document.elementsFromPoint(x, y).find(candidate => !candidate.closest(owned));
    return Boolean(element && !element.closest(RUNTIME_THEME_BLOCKED) && !hasText(element));
  });
}

function sceneSlots(obstacles: RuntimeSceneRect[], width: number, height: number) {
  const eyes: number[] = [], spiders: number[] = [], faces: number[] = [];
  const eyePoints = [.91, .76, .6, .43].flatMap(x => [.88, .74, .59, .95].map(y => [width * x, height * y]));
  eyePoints.forEach(([x, y], index) => {
    if (x - 76 >= 16 && x + 76 <= width - 16 && y - 40 >= 110 && y + 40 <= height - 20
      && slotFits([x - 76, y - 40, x + 76, y + 40], obstacles, width, height)) eyes.push(index);
  });
  [.94, .85, .75, .66, .56].forEach((fraction, index) => {
    const x = width * fraction;
    if (slotFits([x - 56, 82, x + 56, 262], obstacles, width, height)) spiders.push(index);
  });
  const faceWidth = Math.min(320, width * .36), faceTop = height - 448 - 24;
  [width - faceWidth - 24, width * .58, 260].forEach((x, index) => {
    if (faceTop > 110 && slotFits([x, faceTop, x + faceWidth, faceTop + 448], obstacles, width, height)) faces.push(index);
  });
  return { eyes, spiders, faces };
}

function nextNode(walker: TreeWalker, skip: boolean): Node | null {
  if (!skip) return walker.nextNode();
  while (walker.currentNode !== walker.root) {
    const sibling = walker.nextSibling();
    if (sibling) return sibling;
    if (!walker.parentNode()) return null;
  }
  return null;
}

export function measureRuntimeScene(): RuntimeSceneGeometry | null {
  const width = innerWidth, height = innerHeight;
  if (!document.body || !globalThis.CSS?.supports || !(CSS.supports("mask-image", 'url("data:image/svg+xml,%3Csvg/%3E")') || CSS.supports("-webkit-mask-image", 'url("data:image/svg+xml,%3Csvg/%3E")'))) return null;
  const content = document.getElementById("main-content");
  const room = content && roundedSceneRect(content.getBoundingClientRect(), width, height);
  if (!content || !room || document.hidden) return null;
  if (content.getAnimations?.({ subtree: true }).some(animation => animation.playState === "running"
    && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && animation.effect.target.matches(moving))) return null;

  const protection: RuntimeSceneRect[] = [], occupied: RuntimeSceneRect[] = [];
  const observed = new Set<Element>([content]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let inspected = 0;
  let node = walker.nextNode();
  function add(rect: DOMRect, share: boolean): boolean {
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) return false;
    const rounded = roundedSceneRect(rect, width, height);
    if (!rounded) return true;
    return addSceneRect(protection, rounded) && (!share || addSceneRect(occupied, rounded));
  }
  while (node) {
    if (++inspected > maximumNodes) return null;
    if (node instanceof Element) {
      if (node.matches(ignored)) { node = nextNode(walker, true); continue; }
      if (node.matches('.react-draggable-dragging, .react-resizable-resizing')) return null;
      const protectedElement = Boolean(node.closest(RUNTIME_THEME_PROTECTED));
      if (protectedElement || node.matches(surfaces)) {
        if (!add(node.getBoundingClientRect(), !protectedElement)) return null;
        observed.add(node);
      }
    } else if (node.nodeValue?.trim()) {
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (!add(rect, false)) return null;
    }
    node = nextNode(walker, false);
  }
  range.detach();
  const layout: RuntimeSceneLayout = { room, occupied, ...sceneSlots(protection, width, height) };
  if (JSON.stringify({ layout, protection }).length > maximumBytes) return null;
  return { layout, sceneMask: maskImage(protection, width, height), mistMask: maskImage(protection, width, height, room, true), roomMask: maskImage(protection, width, height, room), observed };
}

export function observeRuntimeScene(update: (geometry: RuntimeSceneGeometry | null) => void): () => void {
  if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") { update(null); return () => {}; }
  let active = true, dirty = true, timer = 0, lastMeasure = -Infinity;
  const observed = new Set<Element>();
  const resize = new ResizeObserver(() => invalidate());
  function measure() {
    timer = 0;
    if (!active) return;
    lastMeasure = performance.now();
    let geometry: RuntimeSceneGeometry | null;
    try { geometry = measureRuntimeScene(); }
    catch (error) { console.error("Runtime theme layout unavailable", error); geometry = null; }
    if (geometry) {
      for (const element of observed) if (!geometry.observed.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of geometry.observed) if (!observed.has(element)) { resize.observe(element); observed.add(element); }
    }
    dirty = !geometry;
    update(geometry);
  }
  function invalidate() {
    if (!active) return;
    if (!dirty) { dirty = true; update(null); }
    window.clearTimeout(timer);
    const editing = Boolean(document.activeElement?.closest(RUNTIME_THEME_EDITING));
    const delay = Math.max(editing ? 250 : 80, 200 - (performance.now() - lastMeasure));
    timer = window.setTimeout(measure, delay);
  }
  const mutations = new MutationObserver(records => {
    if (records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      return !target?.closest(owned);
    })) invalidate();
  });
  mutations.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open", "aria-expanded"] });
  const events = ["scroll", "resize", "dragstart", "dragend", "input", "focusin", "focusout", "animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"];
  for (const event of events) window.addEventListener(event, invalidate, true);
  document.addEventListener("visibilitychange", invalidate);
  invalidate();
  return () => {
    active = false; window.clearTimeout(timer); mutations.disconnect(); resize.disconnect();
    for (const event of events) window.removeEventListener(event, invalidate, true);
    document.removeEventListener("visibilitychange", invalidate);
    update(null);
  };
}
