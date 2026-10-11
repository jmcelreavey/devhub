// Browser-side sprite loading for Pong Quest. Files come from /pong/ (built by
// scripts/pong-assets); the manifest says what exists and how big it is.

import { MANIFEST, type AnimationDef, type SpriteDef } from "@/lib/pong/manifest";

export interface LoadedSprite {
  img: HTMLImageElement;
  /** Logical (1x) size in px. The bitmap may be larger on hi-dpi. */
  w: number;
  h: number;
  def: SpriteDef;
}

const BASE = "/pong/";
/** Effective pixels-per-logical-px at which the 2x bitmaps are worth loading. */
export const HI_SCALE = 1.2;

export class PongAssets {
  readonly hi: boolean;
  private images = new Map<string, HTMLImageElement>();
  private loading: Promise<void> | null = null;

  constructor(dpr: number) {
    this.hi = dpr >= HI_SCALE;
  }

  /** Load everything once. Safe to call repeatedly. */
  load(): Promise<void> {
    if (!this.loading) this.loading = this.loadAll();
    return this.loading;
  }

  get ready() { return this.images.size > 0 && this.loading !== null; }

  private fetchImage(file: string): Promise<void> {
    if (this.images.has(file)) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      // decode up front so the first frame that draws a sprite does not stall on it
      img.onload = () => {
        this.images.set(file, img);
        img.decode().then(() => resolve(), () => resolve());
      };
      // A missing file must not take the whole game down: that sprite is simply not drawn.
      img.onerror = () => resolve();
      img.src = `${BASE}${file}`;
    });
  }

  private async loadAll() {
    const wanted: string[] = [];
    const suffix = this.hi ? "@2x" : "";
    for (const [id, s] of Object.entries(MANIFEST.sprites)) {
      wanted.push(`${s.file}${suffix}.webp`);
      // weapons are scaled by Big Racket/Grow: always have the large bitmap
      if (!this.hi && id.startsWith("weapon-")) wanted.push(`${s.file}@2x.webp`);
    }
    for (const a of Object.values(MANIFEST.arenas)) {
      wanted.push(this.hi && a.has2x ? `${a.file}@2x.webp` : `${a.file}.webp`);
    }
    if (MANIFEST.notes.title) wanted.push(`${MANIFEST.notes.title.file}.webp`);
    await Promise.all(wanted.map((f) => this.fetchImage(f)));
  }

  /** Best bitmap for `id`, or undefined if it has not loaded. */
  sprite(id: string): LoadedSprite | undefined {
    const def = MANIFEST.sprites[id];
    if (!def) return undefined;
    const big = this.images.get(`${def.file}@2x.webp`);
    const small = this.images.get(`${def.file}.webp`);
    const img = this.hi || id.startsWith("weapon-") ? (big ?? small) : (small ?? big);
    if (!img) return undefined;
    return { img, w: def.w, h: def.h, def };
  }

  animation(id: string): AnimationDef | undefined {
    return MANIFEST.animations[id];
  }

  frame(animId: string, index: number): LoadedSprite | undefined {
    const a = MANIFEST.animations[animId];
    if (!a) return undefined;
    return this.sprite(a.frames[Math.max(0, Math.min(a.frames.length - 1, index))]);
  }

  arena(id: string): HTMLImageElement | undefined {
    const a = MANIFEST.arenas[id];
    if (!a) return undefined;
    return (this.hi && a.has2x ? this.images.get(`${a.file}@2x.webp`) : undefined) ?? this.images.get(`${a.file}.webp`) ?? this.images.get(`${a.file}@2x.webp`);
  }

  title(): HTMLImageElement | undefined {
    const t = MANIFEST.notes.title;
    return t ? this.images.get(`${t.file}.webp`) : undefined;
  }
}

const cache = new Map<boolean, PongAssets>();

/**
 * One loader per resolution tier for the page's lifetime. `scale` is the
 * on-screen scale of the court in device pixels per logical pixel.
 */
export function getAssets(dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1): PongAssets {
  const hi = dpr >= HI_SCALE;
  let a = cache.get(hi);
  if (!a) {
    a = new PongAssets(dpr);
    cache.set(hi, a);
  }
  return a;
}
