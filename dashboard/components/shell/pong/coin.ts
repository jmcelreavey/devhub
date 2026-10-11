// The gold coin, defined once. The DOM `Coin` (badges.tsx) and the canvas coin
// pop (PongGame) both read this, so the art cannot drift between the HUD, the
// tavern, the draft and the field. Units are a 24 x 24 box.

export const COIN_BOX = 24;
export const COIN_RIM = { r: 10.5, stroke: "#4a2d08", width: 1.4 } as const;
export const COIN_RING = { r: 6.8, stroke: "#b9801c", width: 1.2 } as const;
/** Five-point star emblem. */
export const COIN_STAR = "M12 7.5 L13.2 10.8 L16.5 11 L13.9 13 L14.8 16.3 L12 14.4 L9.2 16.3 L10.1 13 L7.5 11 L10.8 10.8Z";
export const COIN_GRADIENT = [
  [0, "#fff3b0"],
  [0.55, "#e8b132"],
  [1, "#8a5a10"],
] as const;
export const COIN_STAR_FILL = "#b9801c";
/** Specular glint on the upper left of the rim. */
export const COIN_GLINT = { cx: 8.2, cy: 7.6, rx: 2.4, ry: 1.1, rot: -0.62, fill: "rgba(255,255,255,0.7)" } as const;

let star: Path2D | null = null;

/**
 * Draws the coin centred on (x, y), `size` px across, with `squash` (0..1) as the
 * horizontal scale for the spin. Vector, so it stays crisp at any size and dpr.
 */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, squash = 1) {
  star ??= new Path2D(COIN_STAR);
  const k = size / COIN_BOX;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k * squash, k);
  ctx.translate(-COIN_BOX / 2, -COIN_BOX / 2);

  const edge = COIN_BOX / 2 - COIN_RIM.r;
  const grad = ctx.createLinearGradient(edge, edge, COIN_BOX - edge, COIN_BOX - edge);
  for (const [at, color] of COIN_GRADIENT) grad.addColorStop(at, color);
  ctx.beginPath();
  ctx.arc(COIN_BOX / 2, COIN_BOX / 2, COIN_RIM.r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = COIN_RIM.width;
  ctx.strokeStyle = COIN_RIM.stroke;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(COIN_BOX / 2, COIN_BOX / 2, COIN_RING.r, 0, Math.PI * 2);
  ctx.lineWidth = COIN_RING.width;
  ctx.strokeStyle = COIN_RING.stroke;
  ctx.stroke();

  ctx.fillStyle = COIN_STAR_FILL;
  ctx.fill(star);

  ctx.beginPath();
  ctx.ellipse(COIN_GLINT.cx, COIN_GLINT.cy, COIN_GLINT.rx, COIN_GLINT.ry, COIN_GLINT.rot, 0, Math.PI * 2);
  ctx.fillStyle = COIN_GLINT.fill;
  ctx.fill();
  ctx.restore();
}
