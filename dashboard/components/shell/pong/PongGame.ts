// Pong Quest engine.
//
// Rules, balance and entity ids are the original roguelite's. What changed is
// presentation and contact: the ball collides with the weapon as it is drawn
// (rotated hit-zone polygons from the asset manifest), the weapon swings so
// the sweet spot meets the ball on the contact frame, and every impact lands
// with hit-stop, squash, sparks, shake and a weapon-specific sound.

import {
  AI_BASE_HEIGHT,
  BALL_SKINS,
  CREATURE_META,
  H,
  PETS,
  POWERUP_META,
  POWERUP_TYPES,
  POWERUP_WEIGHTS,
  W,
  type CreatureType,
  type PetType,
  type PowerUpType,
} from "@/lib/pong/data";
import {
  BALL_PICKUP_RADIUS,
  BALL_RADIUS,
  BALL_RADIUS_MINI,
  buildGeometry,
  circleContact,
  localToWorld,
  poseForPaddle,
  type Pt,
  worldZone,
  type Contact,
  type WeaponGeometry,
} from "@/lib/pong/hitzone";
import { MANIFEST } from "@/lib/pong/manifest";
import {
  anticipationAngle,
  followAngle,
  FOLLOW_TOTAL,
  predictContact,
  SWING,
  whiffAngle,
  whiffClock,
  WHIFF_TOTAL,
  type Prediction,
} from "@/lib/pong/swing";
import {
  CAST_DASH,
  CAST_TOTAL,
  castDashProgress,
  castFlightProgress,
  castLane,
  castPath,
  DAMAGE_LIFE,
  DAMAGE_RISE,
  damageTextSpot,
  FOE_RAIL_W,
  PET_RAIL_W,
  railBounds,
  railRest,
} from "@/lib/pong/placement";
import { WEAPON_KIND, type PongAudio } from "@/lib/pong/audio";
import type { LoadedSprite, PongAssets } from "./assets";
import { drawCoin } from "./coin";
import {
  AMBIENT_COUNT,
  AMBIENT_COUNT_CALM,
  AMBIENT_FOR_COURT,
  drawAmbient,
  drawFloatTexts,
  drawGlow,
  drawJpText,
  drawSpeedLines,
  drawStar,
  motionAllowed,
  PAL,
  spawnAmbient,
  UI_FONT,
  updateAmbient,
  type Ambient,
  type AnimFx,
  type CoinPop,
  type FloatText,
  type SpeedLines,
} from "./fx";

// ── types ────────────────────────────────────────────────────────────────

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  trail: { x: number; y: number }[];
  /** Seconds since the last weapon hit (drives squash/stretch and the streak). */
  sinceHit: number;
  hitNx: number;
  hitNy: number;
  /** A whiff swing was already played for this ball. */
  whiffed: boolean;
  spin: number;
}

interface PowerUp {
  x: number;
  y: number;
  type: PowerUpType;
  bob: number;
  life: number;
  age: number;
}

interface Creature {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: CreatureType;
  bob: number;
  life: number;
  age: number;
}

/** Visual-only remains of a creature the ball just hit. */
interface Dying {
  x: number;
  y: number;
  type: CreatureType;
  t: number;
  kx: number;
  ky: number;
  rot: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  star: boolean;
}

interface ActiveEffect {
  type: PowerUpType;
  timeLeft: number;
  duration: number;
}

export interface Paddle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatchConfig {
  round: number;
  pointsNeeded: number;
  baseHp: number;
  paddleHeightMult: number;
  ballSpeedMult: number;
  powerupRateMult: number;
  coinMult: number;
  startWithShield: boolean;
  curveball: number;
  startingCoins: number;
  pet: PetType;
  paddleColor: string;
  paddleGlow: string;
  paddleId: string;
  ballId: string;
  ballColor: string;
  ballTrail: boolean;
  ballGlow: string;
  courtId: string;
  courtBg: string;
  courtGrid: string;
  courtLine: string;
}

export interface GameCallbacks {
  onScore: (points: number, needed: number) => void;
  onHurt: (hp: number, maxHp: number) => void;
  onHeal: (hp: number, maxHp: number) => void;
  onShieldChange: (hasShield: boolean) => void;
  onCoins: (total: number) => void;
  onAbility: (slowMeter: number, petCooldown: number) => void;
  onMatchWin: () => void;
  onGameOver: () => void;
}

/** Per-weapon runtime: the held-weapon spring, swing phases and last prediction. */
interface WeaponRt {
  geom: WeaponGeometry;
  spriteId: string;
  /** Rendered forward tilt (rad). */
  angle: number;
  lagAngle: number;
  lagVel: number;
  recoil: number;
  followT: number;
  whiffT: number;
  /** Seconds into the smear; -1 when none. */
  smearT: number;
  /** The whiff whoosh has already played for this swing. */
  whiffVoiced: boolean;
  smearA0: number;
  smearA1: number;
  prevY: number;
  predicted: Prediction | null;
  sweetFlash: number;
}

interface ContactLog {
  x: number;
  y: number;
  nx: number;
  ny: number;
  t: number;
  sweet: boolean;
}

const BALL_ID_FALLBACK = "classic";
const HIT_STOP_MIN = 0.04;
const HIT_STOP_MAX = 0.07;
/** Margin around the court so sparks, speed lines and damage numbers are not cut by the frame. */
/** Drawn height of the familiar, world px, and where its feet sit in its frame. */
const PET_DRAW_H = 96;
const PET_FEET = 0.96;
/** Seconds the familiar stays at the frame edge after its shot lands. */
const CAST_HOLD = 0.18;

export const FX_BLEED_X = 200;
export const FX_BLEED_Y = 140;
const VIEW_W = W + FX_BLEED_X * 2;
const VIEW_H = H + FX_BLEED_Y * 2;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ── engine ───────────────────────────────────────────────────────────────

export class PongGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private paused = false;
  /** Player-requested pause (Esc / P / pause button). Blur pauses on its own and never lifts this. */
  private manualPause = false;
  private dpr = 1;
  private resizeObserver: ResizeObserver | null = null;

  private player: Paddle;
  private ai: Paddle;
  private balls: Ball[] = [];
  private powerUps: PowerUp[] = [];
  private creatures: Creature[] = [];
  private dying: Dying[] = [];
  private particles: Particle[] = [];
  private effects: ActiveEffect[] = [];

  private cfg: MatchConfig;
  private cb: GameCallbacks;
  private sound: PongAudio;
  private assets: PongAssets;

  private pointsScored = 0;
  private hp: number;
  private maxHp: number;
  private hasShield = false;
  private matchOver = false;
  private totalCoins: number;

  // AI state
  private aiHasShield = false;
  private aiEffectTimer = 0;
  private aiEffectType: "none" | "grow" | "shrink" = "none";

  private ballSpeed: number;
  private paddleHeight: number;
  private aiSpeed: number;
  private aiError: number;

  private powerUpSpawnTimer = 0;
  private nextPowerUpAt = 3000;
  private creatureSpawnTimer = 0;
  private nextCreatureAt = 5000;
  private ballResetTimer = 0;
  private waitingForBall = true;

  private keys: Set<string> = new Set();
  private mouseY: number | null = null;
  private useMouse = false;
  private playerVy = 0;
  private rightMouseDown = false;
  private slowMeter = 1;
  private petCooldown = 0;
  private timeBubbleTimer = 0;

  // presentation
  private shake = 0;
  private flashAlpha = 0;
  private flashColor = "#fff";
  private impactWhite = 0;
  /** Rendered steps the full-screen impact frame has left. Independent of dt. */
  private impactFrames = 0;
  private localFlashes: { x: number; y: number; t: number; life: number; r: number }[] = [];
  private hitStop = 0;
  private fxTime = 0;
  private timeScale = 1;
  private combo = 0;
  private texts: FloatText[] = [];
  private anims: AnimFx[] = [];
  private lines: SpeedLines[] = [];
  private coinPops: CoinPop[] = [];
  private ambient: Ambient[] = [];
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgFor = "";
  private wp: WeaponRt;
  private wa: WeaponRt;
  private petRole: { role: string; until: number } = { role: "idle", until: 0 };
  private petSquashT = 99;
  /** fxTime of the last player hit: the familiar hops and cheers. */
  private petHitAt = -99;
  private petHitSweet = false;
  /** fxTime of the foe's last return (its guardian cheers) and of the last point against it (flinches). */
  private foeHitAt = -99;
  private foeFlinchAt = -99;
  private railCache: { key: string; left: HTMLCanvasElement; right: HTMLCanvasElement } | null = null;
  private nextBlink = 2;
  /** The familiar's feet, in the margin beside the court (world px, x < 0). */
  private petX = 0;
  private petY = 0;
  private petReady = false;
  private petSpeed = 0;
  /** Smoothed lean toward the ball, radians. */
  private petTilt = 0;
  private petDims: { w: number; h: number } | null = null;
  /** Ability in flight: the pet dashes to the frame, the shot crosses into the court, then the effect lands. */
  private petCast: { fromX: number; fromY: number; fired: boolean; muzzle: boolean } | null = null;
  /** Sim seconds since the ability was triggered. */
  private petCastT = 99;
  private lastAbilitySent = { m: -1, c: -1 };

  // debug overlay
  private debug = false;
  private contacts: ContactLog[] = [];
  private frameMs = 16.7;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundBlur: () => void;
  private boundFocus: () => void;

  constructor(canvas: HTMLCanvasElement, cfg: MatchConfig, cb: GameCallbacks, sound: PongAudio, assets: PongAssets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cfg = cfg;
    this.cb = cb;
    this.sound = sound;
    this.assets = assets;

    this.dpr = this.measureScale();
    this.applyCanvasSize();

    this.paddleHeight = 80 * cfg.paddleHeightMult;
    this.player = { x: 24, y: H / 2 - this.paddleHeight / 2, w: 14, h: this.paddleHeight };
    this.ai = { x: W - 38, y: H / 2 - AI_BASE_HEIGHT / 2, w: 14, h: AI_BASE_HEIGHT };

    this.maxHp = cfg.baseHp;
    this.hp = cfg.baseHp;
    this.hasShield = cfg.startWithShield;
    this.totalCoins = cfg.startingCoins;

    this.ballSpeed = (5 + cfg.round * 0.4) * cfg.ballSpeedMult;
    this.aiSpeed = 3.5 + cfg.round * 0.35;
    this.aiError = Math.max(15, 90 - cfg.round * 6);

    this.wp = this.makeWeapon(MANIFEST.weapons[cfg.paddleId] ? cfg.paddleId : "classic", this.player.y);
    this.wa = this.makeWeapon("foe", this.ai.y);

    const kind = AMBIENT_FOR_COURT[cfg.courtId] ?? "dust";
    const count = motionAllowed() ? AMBIENT_COUNT : AMBIENT_COUNT_CALM;
    for (let i = 0; i < count; i++) this.ambient.push(spawnAmbient(kind, W, H, true));

    this.boundKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.key);
      if (["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(e.key)) e.preventDefault();
      if ((e.key === "h" || e.key === "H" || e.key === "F3") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.debug = !this.debug;
        if (e.key === "F3") e.preventDefault();
      }
    };
    this.boundKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key);
    this.boundMouseMove = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.height === 0) return;
      const scaleY = VIEW_H / rect.height;
      this.mouseY = (e.clientY - rect.top) * scaleY - FX_BLEED_Y;
      this.useMouse = true;
    };
    this.boundMouseDown = (e: MouseEvent) => {
      if (e.button === 0) this.activatePet();
      if (e.button === 2) {
        e.preventDefault();
        this.rightMouseDown = true;
      }
    };
    this.boundMouseUp = (e: MouseEvent) => {
      if (e.button === 2) this.rightMouseDown = false;
    };
    this.boundContextMenu = (e: MouseEvent) => e.preventDefault();
    this.boundTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      if (rect.height === 0) return;
      const scaleY = VIEW_H / rect.height;
      this.mouseY = (e.touches[0].clientY - rect.top) * scaleY - FX_BLEED_Y;
      this.useMouse = true;
    };
    this.boundBlur = () => { this.paused = true; };
    this.boundFocus = () => { this.paused = false; this.lastTime = performance.now(); };
  }

  /** Device pixels per logical court pixel at the size the frame is shown. */
  private measureScale(): number {
    const css = this.canvas.getBoundingClientRect().width || VIEW_W;
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    return clamp((css / VIEW_W) * ratio, 1, 3);
  }

  private applyCanvasSize() {
    this.canvas.width = Math.round(VIEW_W * this.dpr);
    this.canvas.height = Math.round(VIEW_H * this.dpr);
    this.bgCanvas = null;
  }

  private makeWeapon(id: string, y: number): WeaponRt {
    const def = MANIFEST.weapons[id];
    const sprite = MANIFEST.sprites[def.sprite];
    return {
      geom: buildGeometry(id, def, sprite),
      spriteId: def.sprite,
      angle: 0, lagAngle: 0, lagVel: 0, recoil: 0,
      followT: -1, whiffT: -1, whiffVoiced: false, smearT: -1, smearA0: 0, smearA1: 0,
      prevY: y, predicted: null, sweetFlash: 0,
    };
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  start() {
    this.running = true;
    this.matchOver = false;
    this.waitingForBall = true;
    this.ballResetTimer = 1000;

    window.addEventListener("keydown", this.boundKeyDown as EventListener);
    window.addEventListener("keyup", this.boundKeyUp as EventListener);
    window.addEventListener("mousemove", this.boundMouseMove);
    window.addEventListener("mousedown", this.boundMouseDown);
    window.addEventListener("mouseup", this.boundMouseUp);
    window.addEventListener("contextmenu", this.boundContextMenu);
    window.addEventListener("blur", this.boundBlur);
    window.addEventListener("focus", this.boundFocus);
    this.canvas.addEventListener("touchmove", this.boundTouchMove, { passive: false });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        const next = this.measureScale();
        if (Math.abs(next - this.dpr) > 0.05) {
          this.dpr = next;
          this.applyCanvasSize();
        }
      });
      this.resizeObserver.observe(this.canvas);
    }

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.boundKeyDown as EventListener);
    window.removeEventListener("keyup", this.boundKeyUp as EventListener);
    window.removeEventListener("mousemove", this.boundMouseMove);
    window.removeEventListener("mousedown", this.boundMouseDown);
    window.removeEventListener("mouseup", this.boundMouseUp);
    window.removeEventListener("contextmenu", this.boundContextMenu);
    window.removeEventListener("blur", this.boundBlur);
    window.removeEventListener("focus", this.boundFocus);
    this.canvas.removeEventListener("touchmove", this.boundTouchMove);
  }

  // ── test/debug hooks (used by the screenshot harness) ────────────

  /** Pause or resume on request. Held keys are dropped so nothing sticks across the pause. */
  setManualPause(on: boolean) {
    if (this.manualPause === on) return;
    this.manualPause = on;
    this.keys.clear();
    this.rightMouseDown = false;
    if (!on) this.lastTime = performance.now();
  }

  get isManuallyPaused(): boolean {
    return this.manualPause;
  }

  /** Advance exactly one fixed step and draw. Only the harness calls this. */
  debugStep(dt: number) {
    this.stepFrame(dt);
  }
  debugSetTimeScale(s: number) { this.timeScale = s; }
  /** Stop the display loop so a frame-by-frame capture isn't fighting a software render. */
  debugHold() {
    this.timeScale = 0;
    cancelAnimationFrame(this.rafId);
  }
  debugToggleOverlay(on?: boolean) { this.debug = on ?? !this.debug; }
  debugState() {
    return {
      balls: this.balls.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r })),
      player: { ...this.player },
      ai: { ...this.ai },
      hitStop: this.hitStop,
      combo: this.combo,
      points: this.pointsScored,
      hp: this.hp,
      waiting: this.waitingForBall,
      playerAngle: this.wp.angle,
      predicted: this.wp.predicted,
      contacts: this.contacts.slice(-8),
      pet: { x: this.petX, y: this.petY, w: this.petDims?.w ?? 0, h: this.petDims?.h ?? 0, castT: this.petCastT, casting: this.petCast !== null },
    };
  }
  /** Put the ball on a collision course with the player's weapon. */
  debugServe(y: number, speed = 9, vy = 0) {
    this.waitingForBall = false;
    this.balls = [this.newBall(W - 160, y, -speed, vy)];
  }
  debugPlace(playerCenterY: number) {
    this.useMouse = true;
    this.mouseY = playerCenterY;
    this.player.y = clamp(playerCenterY - this.player.h / 2, 0, H - this.player.h);
  }
  debugView() {
    return { bleedX: FX_BLEED_X, bleedY: FX_BLEED_Y, viewW: VIEW_W, viewH: VIEW_H, courtW: W, courtH: H };
  }
  debugSpawn(kind: "powerup" | "creature", type: string, x: number, y: number) {
    if (kind === "powerup") {
      this.powerUps.push({ x, y, type: type as PowerUpType, bob: 0, life: 8000, age: 0 });
    } else {
      this.creatures.push({ x, y, vx: 0, vy: 0, type: type as CreatureType, bob: 0, life: 8000, age: 0 });
    }
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const raw = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frameMs = this.frameMs * 0.9 + raw * 1000 * 0.1;
    this.stepFrame(raw * this.timeScale);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private stepFrame(dt: number) {
    this.fxTime += dt;
    this.updateFx(dt);
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
    } else {
      this.update(dt);
    }
    this.render();
  }

  // ── simulation ─────────────────────────────────────────────────────

  private update(dt: number) {
    if (this.matchOver || this.paused || this.manualPause) return;

    this.updatePlayer(dt);
    this.updateAI(dt);
    this.updateWeapon(this.wp, this.player, false, dt);
    this.updateWeapon(this.wa, this.ai, true, dt);

    if (this.waitingForBall) {
      this.ballResetTimer -= dt * 1000;
      if (this.ballResetTimer <= 0) {
        this.resetBall();
        this.waitingForBall = false;
      }
    } else {
      this.updateBalls(dt);
    }

    this.updatePowerUps(dt);
    this.updateCreatures(dt);
    this.updateEffects(dt);
    this.updateAIEffect(dt);
    this.updateAbilities(dt);
    this.spawnPowerUps(dt);
    this.spawnCreatures(dt);
  }

  /** Presentation timers: they keep running through hit-stop and pause. */
  private updateFx(dt: number) {
    const calm = motionAllowed();
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 4);
    // One or two steps that actually advance time. A paused redraw (dt = 0) must not eat the frame,
    // and the counter is not proportional to dt, so a 1/240 capture cannot hold a white fog.
    if (dt > 0 && this.impactFrames > 0) {
      this.impactFrames -= 1;
      if (this.impactFrames <= 0) this.impactWhite = 0;
      else this.impactWhite *= 0.18;
    }
    for (let i = this.localFlashes.length - 1; i >= 0; i--) {
      this.localFlashes[i].t += dt;
      if (this.localFlashes[i].t >= this.localFlashes[i].life) this.localFlashes.splice(i, 1);
    }
    this.petSquashT += dt;
    this.updatePet(dt);
    this.wp.sweetFlash = Math.max(0, this.wp.sweetFlash - dt * 6);
    for (const b of this.balls) b.sinceHit += dt;
    this.updateParticlesStep(dt);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      this.texts[i].t += dt;
      if (this.texts[i].t >= this.texts[i].life) this.texts.splice(i, 1);
    }
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const def = MANIFEST.animations[a.anim];
      if (!def || a.t * a.fps >= def.frames.length) this.anims.splice(i, 1);
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      this.lines[i].t += dt;
      if (this.lines[i].t >= this.lines[i].life) this.lines.splice(i, 1);
    }
    for (let i = this.coinPops.length - 1; i >= 0; i--) {
      const c = this.coinPops[i];
      c.t += dt;
      c.vy += 900 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      if (c.t >= c.life) this.coinPops.splice(i, 1);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      d.x += d.kx * dt;
      d.y += d.ky * dt;
      d.kx *= Math.exp(-dt * 9);
      d.ky *= Math.exp(-dt * 9);
      if (d.t > 0.6) this.dying.splice(i, 1);
    }
    const calmK = calm ? 1 : 0.25;
    for (let i = this.ambient.length - 1; i >= 0; i--) {
      if (!updateAmbient(this.ambient[i], dt, W, H, calmK)) {
        this.ambient[i] = spawnAmbient(this.ambient[i].kind, W, H, false);
      }
    }
    for (let i = this.contacts.length - 1; i >= 0; i--) {
      if (this.fxTime - this.contacts[i].t > 2.5) this.contacts.splice(i, 1);
    }
    // pet blink scheduling
    if (this.fxTime >= this.nextBlink && this.petRole.until < this.fxTime) {
      this.petRole = { role: "blink", until: this.fxTime + 0.13 };
      this.nextBlink = this.fxTime + 2.4 + Math.random() * 3;
    }
  }

  private isTimeSlowActive() {
    return this.rightMouseDown && this.slowMeter > 0;
  }

  private updateAbilities(dt: number) {
    const wasSlow = this.isTimeSlowActive();
    if (wasSlow) {
      this.slowMeter = Math.max(0, this.slowMeter - dt * 0.65);
      if (this.slowMeter === 0) this.rightMouseDown = false;
    } else {
      this.slowMeter = Math.min(1, this.slowMeter + dt * 0.25);
    }
    if (this.petCooldown > 0) this.petCooldown = Math.max(0, this.petCooldown - dt);
    if (this.petCast) {
      this.petCastT += dt;
      if (!this.petCast.fired && this.petCastT >= CAST_TOTAL) {
        this.petCast.fired = true;
        this.fireFamiliar();
      }
      if (this.petCastT >= CAST_TOTAL + CAST_HOLD) this.petCast = null;
    }
    if (this.timeBubbleTimer > 0) this.timeBubbleTimer = Math.max(0, this.timeBubbleTimer - dt);
    this.sendAbility(this.petCooldown / 4);
  }

  /** The HUD re-renders on every call, so only report changes a player could see. */
  private sendAbility(cooldown: number) {
    const m = Math.round(this.slowMeter * 100);
    const c = Math.round(cooldown * 100);
    if (m === this.lastAbilitySent.m && c === this.lastAbilitySent.c) return;
    this.lastAbilitySent = { m, c };
    this.cb.onAbility(this.slowMeter, cooldown);
  }

  private activatePet() {
    if (this.matchOver || this.paused || this.manualPause || this.petCooldown > 0) return;
    this.petCooldown = 4;
    this.petSquashT = 0;
    // The familiar dashes to the frame and fires; the effect lands when its shot
    // arrives (CAST_TOTAL, a quarter second). The cue plays now so the click answers at once.
    this.petCast = { fromX: this.petX, fromY: this.petY, fired: false, muzzle: false };
    this.petCastT = 0;
    if (this.cfg.pet === "turtle") this.sound.powerup("slowmo");
    else if (this.cfg.pet === "bat") this.sound.monster("fairy");
    else this.sound.powerup("grow");
    this.lastAbilitySent = { m: -1, c: -1 };
    this.cb.onAbility(this.slowMeter, 1);
  }

  /** Where the familiar's shot takes effect: beside the player's weapon. */
  private castOrigin(): Pt {
    const y = this.player.y + this.player.h / 2;
    return { x: this.player.x + this.player.w + (this.cfg.pet === "turtle" ? 58 : 30), y };
  }

  /** The shot arrived: the ability itself, as it always was. */
  private fireFamiliar() {
    const y = this.player.y + this.player.h / 2;
    if (this.cfg.pet === "turtle") {
      this.timeBubbleTimer = 2.2;
      this.flash("#34d399", 0.1);
      this.emit(this.player.x + this.player.w + 45, y, PETS.turtle.color, 34, 5);
    } else if (this.cfg.pet === "bat") {
      this.balls.push(this.newBall(this.player.x + 30, y, this.ballSpeed * 1.25, (Math.random() - 0.5) * this.ballSpeed, BALL_RADIUS_MINI));
      this.emit(this.player.x + 30, y, PETS.bat.color, 18, 5);
    } else {
      for (const ball of this.balls) {
        ball.vx = Math.abs(ball.vx) * 1.45;
        ball.vy *= 1.1;
      }
      if (this.balls.length === 0) {
        this.balls.push(this.newBall(this.player.x + 30, y, this.ballSpeed * 1.6, 0, BALL_RADIUS));
        this.waitingForBall = false;
      }
      this.emit(this.player.x + 30, y, PETS.dragon.color, 24, 6);
    }
  }

  private newBall(x: number, y: number, vx: number, vy: number, r = BALL_RADIUS): Ball {
    return { x, y, vx, vy, r, trail: [], sinceHit: 9, hitNx: 1, hitNy: 0, whiffed: false, spin: Math.random() * 6 };
  }

  private updatePlayer(dt: number) {
    const accel = 4000;
    const maxSpeed = 650;
    const friction = 0.82;
    let keyMoved = false;

    if (this.keys.has("ArrowUp") || this.keys.has("w") || this.keys.has("W")) {
      this.playerVy -= accel * dt;
      keyMoved = true;
    }
    if (this.keys.has("ArrowDown") || this.keys.has("s") || this.keys.has("S")) {
      this.playerVy += accel * dt;
      keyMoved = true;
    }

    if (keyMoved) {
      this.playerVy = Math.max(-maxSpeed, Math.min(maxSpeed, this.playerVy));
      this.playerVy *= friction;
      this.player.y += this.playerVy * dt;
      this.useMouse = false;
    }

    if (this.useMouse && this.mouseY !== null) {
      const center = this.player.y + this.player.h / 2;
      const diff = this.mouseY - center;
      this.player.y += diff * Math.min(1, dt * 18);
      this.playerVy = 0;
    }

    this.clampPaddle(this.player);
  }

  private updateAI(dt: number) {
    const threats = this.balls.filter((b) => b.vx > 0);
    let targetY: number;

    if (threats.length === 0) {
      targetY = H / 2;
    } else {
      const ball = threats.reduce((c, b) => (b.x > c.x ? b : c));
      const timeToReach = (this.ai.x - ball.x) / ball.vx;

      if (timeToReach > 0 && timeToReach < 2) {
        let predY = ball.y + ball.vy * timeToReach;
        while (predY < 0 || predY > H) {
          if (predY < 0) predY = -predY;
          if (predY > H) predY = 2 * H - predY;
        }
        targetY = predY;
      } else {
        targetY = ball.y;
      }
      targetY += (Math.random() - 0.5) * this.aiError;
    }

    const center = this.ai.y + this.ai.h / 2;
    const diff = targetY - center;
    const move = Math.sign(diff) * Math.min(Math.abs(diff), this.aiSpeed * dt * 60);
    this.ai.y += move;
    this.clampPaddle(this.ai);
  }

  private clampPaddle(p: Paddle) {
    p.y = Math.max(0, Math.min(H - p.h, p.y));
  }

  private ballSlowFactor(ball: Ball) {
    const global = this.effects.some((e) => e.type === "slowmo") || this.isTimeSlowActive() ? 0.45 : 1;
    return global * (this.isInTimeBubble(ball) ? 0.28 : 1);
  }

  // ── held weapons ───────────────────────────────────────────────────

  private updateWeapon(w: WeaponRt, paddle: Paddle, mirror: boolean, dt: number) {
    const vy = (paddle.y - w.prevY) / Math.max(dt, 1e-4);
    w.prevY = paddle.y;
    // The weapon is held at the grip, so it lags the hand: a damped spring on its tilt.
    const target = clamp(vy / 5200, -0.12, 0.12);
    w.lagVel += (230 * (target - w.lagAngle) - 17 * w.lagVel) * dt;
    w.lagAngle += w.lagVel * dt;
    w.recoil *= Math.exp(-dt * 20);

    let best: Prediction | null = null;
    for (const b of this.balls) {
      const towards = mirror ? b.vx > 0 : b.vx < 0;
      if (!towards) continue;
      const p = predictContact(w.geom, paddle, mirror, b, { courtH: H, speedFactor: this.ballSlowFactor(b), horizon: 0.2, recoil: w.recoil });
      if (p && (!best || p.tau < best.tau)) best = p;
    }
    w.predicted = best;

    if (w.followT >= 0) {
      w.followT += dt;
      w.angle = followAngle(w.followT);
      w.smearT = SWING.window * 0.55 + w.followT;
      w.smearA1 = Math.max(w.smearA1, w.angle);
      if (w.followT > FOLLOW_TOTAL) { w.followT = -1; w.smearT = -1; }
    } else if (w.whiffT >= 0) {
      const before = w.whiffT;
      w.whiffT += dt;
      w.angle = whiffAngle(w.whiffT);
      w.smearT = Math.max(-1, w.whiffT - 0.04);
      w.smearA0 = SWING.windupAngle;
      w.smearA1 = Math.max(w.smearA1, w.angle);
      if (!w.whiffVoiced && before < SWING.whiffWind && w.whiffT >= SWING.whiffWind) {
        w.whiffVoiced = true;
        if (!mirror) this.sound.whiff();
      }
      if (w.whiffT > WHIFF_TOTAL) { w.whiffT = -1; w.smearT = -1; w.whiffVoiced = false; }
    } else if (best && best.tau <= SWING.window) {
      w.angle = anticipationAngle(best.tau);
      const swingStart = SWING.window * 0.55;
      if (best.tau <= swingStart) {
        w.smearT = swingStart - best.tau;
        w.smearA0 = SWING.windupAngle;
        w.smearA1 = w.angle;
      } else {
        w.smearT = -1;
      }
    } else {
      w.angle = w.lagAngle;
      w.smearT = -1;
    }

    // A miss gets a swing that is already wound up so the cut meets the ball
    // at the contact plane. Starting after the ball has gone past reads as a late flail.
    if (!best && w.followT < 0 && w.whiffT < 0) {
      const face = this.bladeFaceX(w, paddle, mirror);
      const center = paddle.y + paddle.h / 2;
      for (const b of this.balls) {
        const towards = mirror ? b.vx > 0 : b.vx < 0;
        if (!towards || b.whiffed) continue;
        if (Math.abs(b.y - center) > paddle.h / 2 + 90) continue;
        const speed = Math.abs(b.vx) * 60 * this.ballSlowFactor(b);
        if (speed < 8) continue;
        const dist = mirror ? face - b.x : b.x - face;
        const clock = whiffClock(dist / speed);
        if (clock === null) continue;
        b.whiffed = true;
        w.whiffT = clock;
        w.smearA0 = SWING.windupAngle;
        w.smearA1 = whiffAngle(clock);
        w.whiffVoiced = clock >= SWING.whiffWind;
        if (w.whiffVoiced && !mirror) this.sound.whiff();
        break;
      }
    }
  }

  private weaponPose(w: WeaponRt, paddle: Paddle, mirror: boolean) {
    return poseForPaddle(w.geom, paddle, mirror, w.angle, w.recoil);
  }

  // ── balls ──────────────────────────────────────────────────────────

  private updateBalls(dt: number) {
    const frames = dt * 60;
    const MAX_STEP = 5; // px per sub-step: nothing tunnels through a blade

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      const slowFactor = this.ballSlowFactor(ball);

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 12) ball.trail.shift();
      ball.spin += dt * 4;

      const dist = Math.hypot(ball.vx, ball.vy) * frames * slowFactor;
      const n = clamp(Math.ceil(dist / MAX_STEP), 1, 16);
      const sub = (frames * slowFactor) / n;
      let gone = false;

      for (let k = 0; k < n && !gone; k++) {
        ball.x += ball.vx * sub;
        ball.y += ball.vy * sub;

        if (ball.y - ball.r < 0) {
          ball.y = ball.r; ball.vy = Math.abs(ball.vy);
          this.sound.wall();
          this.emit(ball.x, ball.y, "#ffffff", 4, 2);
        }
        if (ball.y + ball.r > H) {
          ball.y = H - ball.r; ball.vy = -Math.abs(ball.vy);
          this.sound.wall();
          this.emit(ball.x, ball.y, "#ffffff", 4, 2);
        }

        this.checkPaddleHit(ball, this.player, true);
        this.checkPaddleHit(ball, this.ai, false);
        this.checkBallPowerUps(ball);
        this.checkBallCreatures(ball);

        if (ball.x < -ball.r) { this.balls.splice(i, 1); this.onAIScore(); gone = true; }
        else if (ball.x > W + ball.r) { this.balls.splice(i, 1); this.onPlayerScore(ball.y); gone = true; }
      }
    }

    if (this.balls.length === 0 && !this.matchOver && !this.waitingForBall) {
      this.waitingForBall = true;
      this.ballResetTimer = 800;
    }
  }

  private isInTimeBubble(ball: Ball) {
    if (this.timeBubbleTimer <= 0) return false;
    const cx = this.player.x + this.player.w + 58;
    const cy = this.player.y + this.player.h / 2;
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    return Math.sqrt(dx * dx + dy * dy) < 90;
  }

  private checkPaddleHit(ball: Ball, paddle: Paddle, isPlayer: boolean) {
    if (isPlayer && ball.vx >= 0) return;
    if (!isPlayer && ball.vx <= 0) return;
    const w = isPlayer ? this.wp : this.wa;
    // already past the back of the paddle: it is a miss, as before
    if (isPlayer ? ball.x + ball.r < paddle.x : ball.x - ball.r > paddle.x + paddle.w) return;
    const faceX = isPlayer ? paddle.x + paddle.w : paddle.x;
    if (Math.abs(ball.x - faceX) > 170) return;
    const pose = this.weaponPose(w, paddle, !isPlayer);
    const c = circleContact(w.geom, pose, ball.x, ball.y, ball.r);
    if (!c) return;
    this.resolveWeaponHit(ball, paddle, isPlayer, c);
  }

  /** The ball met the rendered blade at contact point `c`. */
  private resolveWeaponHit(ball: Ball, paddle: Paddle, isPlayer: boolean, c: Contact) {
    const w = isPlayer ? this.wp : this.wa;
    if (!isPlayer) this.foeHitAt = this.fxTime;

    // Deflection is the original paddle formula: where on the paddle it landed.
    const hitPos = (ball.y - (paddle.y + paddle.h / 2)) / (paddle.h / 2);
    const clamped = Math.max(-0.5, Math.min(0.5, hitPos));
    const baseAngle = clamped * Math.PI * 0.35;
    const curveBonus = isPlayer ? this.cfg.curveball * 0.1 : 0;
    const angle = baseAngle * (1 + curveBonus);
    const direction = isPlayer ? 1 : -1;

    const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    const sweet = c.sweet && isPlayer;
    const gain = 1.04 + (sweet ? 0.05 : 0);
    const newSpeed = Math.min(currentSpeed * gain, this.ballSpeed * 2.5);

    ball.vx = direction * newSpeed * Math.cos(angle);
    ball.vy = newSpeed * Math.sin(angle);

    const minVy = newSpeed * 0.12;
    if (Math.abs(ball.vy) < minVy) ball.vy = (ball.vy >= 0 ? 1 : -1) * minVy;

    // Sit exactly on the blade surface so the picture matches the physics.
    ball.x = c.x + c.nx * (ball.r + 0.6);
    ball.y = clamp(c.y + c.ny * (ball.r + 0.6), ball.r, H - ball.r);
    if (isPlayer && ball.x < paddle.x + 2) ball.x = paddle.x + 2;

    // ── feel ──
    const speed01 = clamp(newSpeed / (this.ballSpeed * 2.5), 0, 1);
    const calm = motionAllowed();
    ball.sinceHit = 0;
    ball.hitNx = c.nx;
    ball.hitNy = c.ny;
    ball.whiffed = false;

    this.hitStop = Math.max(this.hitStop, HIT_STOP_MIN + (HIT_STOP_MAX - HIT_STOP_MIN) * (speed01 * 0.8 + (sweet ? 0.2 : 0)));
    this.shake = calm ? Math.min(10, Math.max(this.shake, 2 + speed01 * 6 + (sweet ? 2 : 0))) : 0;
    w.recoil = 3 + speed01 * 5 + (sweet ? 3 : 0);
    w.followT = 0;
    w.smearA0 = SWING.windupAngle;
    w.smearA1 = w.angle;
    if (sweet) w.sweetFlash = 1;
    if (calm) {
      if (sweet) {
        this.impactWhite = 0.82;
        this.impactFrames = 2;
      } else if (speed01 > 0.55) {
        this.impactWhite = 0.2;
        this.impactFrames = 1;
      }
      this.localFlashes.push({
        x: c.x, y: c.y, t: 0,
        life: sweet ? 0.15 : 0.09,
        r: (sweet ? 86 : 54) * (0.8 + speed01 * 0.45),
      });
      if (sweet || speed01 > 0.5) {
        this.lines.push({ x: c.x, y: c.y, t: 0, life: sweet ? 0.14 : 0.1, len: 60 + speed01 * 90 + (sweet ? 40 : 0), seed: Math.random() * 10 });
      }
    }
    this.anims.push({
      x: c.x, y: c.y, t: 0, anim: "vfx-spark", fps: 26,
      scale: (isPlayer ? 38 : 30) / 128 * (1 + speed01 * 0.6) * (sweet ? 1.6 : 1),
      rot: Math.atan2(c.ny, c.nx), alpha: 1, additive: true,
    });
    this.emit(c.x, c.y, isPlayer ? this.cfg.paddleColor : "#e04050", sweet ? 14 : 8, sweet ? 4 : 3);
    this.sound.hit(WEAPON_KIND[isPlayer ? this.cfg.paddleId : "classic"] ?? "sword", speed01, sweet, !isPlayer);

    this.contacts.push({ x: c.x, y: c.y, nx: c.nx, ny: c.ny, t: this.fxTime, sweet });

    if (isPlayer) {
      this.combo++;
      // the familiar cheers a sweet spot or a streak, hops for an ordinary hit
      const cheer = sweet || this.combo >= 3;
      this.petRole = { role: cheer ? "cheer" : "hop", until: this.fxTime + (cheer ? 0.5 : 0.2) };
      this.petHitAt = this.fxTime;
      this.petHitSweet = sweet;
      const dmg = Math.round(newSpeed * 13 * (sweet ? 1.5 : 1));
      // toward the court centre and above the contact, never over the blade
      const spot = damageTextSpot(c, 1, -FX_BLEED_X + 60, W + FX_BLEED_X - 60);
      this.texts.push({
        x: spot.x, y: spot.y, vy: -DAMAGE_RISE, t: 0, life: DAMAGE_LIFE,
        text: String(dmg), fill: sweet ? "#fff1a8" : "#ffffff", stroke: sweet ? "#ff8a00" : "#5a7bff",
        size: sweet ? 30 : 20 + speed01 * 6, pop: sweet ? 0.7 : 0.45, sub: sweet ? "SWEET SPOT!" : undefined,
      });
      if (this.combo >= 2) {
        this.texts.push({
          // right of the P1 nameplate
          x: 250, y: 72, vy: -4, t: 0, life: 0.9, text: `${this.combo} HIT`, fill: PAL.gold, stroke: "#c2410c",
          size: 22 + Math.min(10, this.combo), pop: 0.5, sub: "COMBO",
        });
      }
    }
  }

  private checkBallPowerUps(ball: Ball) {
    for (let j = this.powerUps.length - 1; j >= 0; j--) {
      const pu = this.powerUps[j];
      const py = pu.y + Math.sin(pu.bob) * 6;
      const dx = ball.x - pu.x;
      const dy = ball.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < BALL_PICKUP_RADIUS + 16) {
        const forPlayer = ball.vx > 0;
        this.applyPowerUp(pu.type, forPlayer);
        this.sound.powerup(pu.type);
        const meta = POWERUP_META[pu.type];
        this.emit(pu.x, py, meta.color, 15, 4);
        this.anims.push({ x: pu.x, y: py, t: 0, anim: "vfx-spark", fps: 24, scale: 0.7, rot: 0, alpha: 1, additive: true });
        this.texts.push({ x: pu.x, y: py - 18, vy: -38, t: 0, life: 0.9, text: `${meta.label}!`, fill: "#ffffff", stroke: meta.color, size: 18, pop: 0.5 });
        this.powerUps.splice(j, 1);
      }
    }
  }

  private checkBallCreatures(ball: Ball) {
    for (let j = this.creatures.length - 1; j >= 0; j--) {
      const c = this.creatures[j];
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      if (Math.sqrt(dx * dx + dy * dy) < BALL_PICKUP_RADIUS + 14) {
        const before = this.totalCoins;
        this.applyCreatureEffect(c);
        this.sound.monster(c.type);
        this.emit(c.x, c.y, CREATURE_META[c.type].color, 20, 5);
        const sp = Math.hypot(ball.vx, ball.vy) || 1;
        this.dying.push({ x: c.x, y: c.y, type: c.type, t: 0, kx: (ball.vx / sp) * 150, ky: (ball.vy / sp) * 150, rot: ball.vx > 0 ? 0.35 : -0.35 });
        this.hitStop = Math.max(this.hitStop, 0.035);
        const gained = this.totalCoins - before;
        if (gained > 0) this.coinBurst(c.x, c.y, gained);
        else {
          const label = c.type === "demon" ? "SPEED UP!" : c.type === "fairy" ? "HEAL!" : c.type === "blob" ? "CHAOS!" : "";
          if (label) this.texts.push({ x: c.x, y: c.y - 26, vy: -34, t: 0, life: 0.9, text: label, fill: "#ffffff", stroke: CREATURE_META[c.type].color, size: 16, pop: 0.4 });
        }
        this.creatures.splice(j, 1);
      }
    }
  }

  private coinBurst(x: number, y: number, amount: number) {
    const n = clamp(Math.round(amount / 4) + 2, 3, 9);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 120 + Math.random() * 180;
      this.coinPops.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.7 + Math.random() * 0.2, rot: 0, spin: (Math.random() - 0.5) * 18 });
    }
    this.texts.push({ x, y: y - 20, vy: -42, t: 0, life: 0.95, text: `+${amount}`, fill: "#ffe27a", stroke: "#a86400", size: 20, pop: 0.5 });
    this.sound.coin(Math.ceil(amount / 10));
  }

  private applyPowerUp(type: PowerUpType, forPlayer: boolean) {
    if (forPlayer) {
      switch (type) {
        case "grow":
          this.addEffect("grow", 6000);
          this.player.h = this.paddleHeight * 1.6;
          this.clampPaddle(this.player);
          break;
        case "multiball": {
          const main = this.balls[0];
          if (main) {
            for (let i = 0; i < 2; i++) {
              const a = (Math.random() - 0.5) * Math.PI * 0.5;
              const s = Math.sqrt(main.vx * main.vx + main.vy * main.vy);
              this.balls.push(this.newBall(main.x, main.y, Math.sign(main.vx) * s * Math.cos(a), s * Math.sin(a)));
            }
          }
          break;
        }
        case "slowmo": this.addEffect("slowmo", 4000); break;
        case "shield": this.hasShield = true; this.cb.onShieldChange(true); break;
        case "heart":
          if (this.hp < this.maxHp) { this.hp++; this.cb.onHeal(this.hp, this.maxHp); }
          else { this.totalCoins += Math.round(15 * this.cfg.coinMult); this.cb.onCoins(this.totalCoins); }
          break;
      }
    } else {
      switch (type) {
        case "grow":
          this.aiEffectType = "grow"; this.aiEffectTimer = 6000;
          this.ai.h = AI_BASE_HEIGHT * 1.6; this.clampPaddle(this.ai);
          break;
        case "shield": this.aiHasShield = true; break;
        case "multiball": {
          const main = this.balls[0];
          if (main) {
            for (let i = 0; i < 2; i++) {
              const a = (Math.random() - 0.5) * Math.PI * 0.5;
              const s = Math.sqrt(main.vx * main.vx + main.vy * main.vy);
              this.balls.push(this.newBall(main.x, main.y, Math.sign(main.vx) * s * Math.cos(a), s * Math.sin(a)));
            }
          }
          break;
        }
        case "slowmo": this.addEffect("slowmo", 4000); break;
        case "heart": break;
      }
    }
  }

  private applyCreatureEffect(c: Creature) {
    switch (c.type) {
      case "ghost":
        this.totalCoins += Math.round(15 * this.cfg.coinMult);
        this.cb.onCoins(this.totalCoins);
        break;
      case "demon":
        for (const ball of this.balls) { ball.vx *= 1.3; ball.vy *= 1.3; }
        break;
      case "fairy":
        if (this.hp < this.maxHp) { this.hp++; this.cb.onHeal(this.hp, this.maxHp); }
        else { this.totalCoins += Math.round(20 * this.cfg.coinMult); this.cb.onCoins(this.totalCoins); }
        break;
      case "blob": {
        const roll = Math.floor(Math.random() * 5);
        if (roll === 0) { this.totalCoins += 25; this.cb.onCoins(this.totalCoins); }
        else if (roll === 1) {
          const main = this.balls[0];
          if (main) {
            const s = Math.sqrt(main.vx * main.vx + main.vy * main.vy);
            const a = (Math.random() - 0.5) * Math.PI * 0.5;
            this.balls.push(this.newBall(main.x, main.y, s * Math.cos(a), s * Math.sin(a)));
          }
        } else if (roll === 2) { for (const b of this.balls) b.vx *= -1; }
        else if (roll === 3) {
          this.aiEffectType = "shrink"; this.aiEffectTimer = 4000;
          this.ai.h = AI_BASE_HEIGHT * 0.5; this.clampPaddle(this.ai);
        } else { for (const b of this.balls) { b.vx *= 1.2; b.vy *= 1.2; } }
        break;
      }
    }
  }

  private onPlayerScore(ballY = H / 2) {
    this.combo = 0;
    if (this.aiHasShield) {
      this.aiHasShield = false;
      this.sound.shield();
      this.flash("#facc15", 0.15);
      this.texts.push({ x: W - 70, y: clamp(ballY, 50, H - 50), vy: -30, t: 0, life: 0.9, text: "BLOCKED", fill: "#fff", stroke: "#a16207", size: 18, pop: 0.4 });
      return;
    }
    this.pointsScored++;
    const gained = Math.round(5 * this.cfg.coinMult);
    this.totalCoins += gained;
    this.sound.score();
    this.flash("#22c55e", 0.12);
    this.shake = motionAllowed() ? 6 : 0;
    this.petRole = { role: "cheer", until: this.fxTime + 0.9 };
    this.foeFlinchAt = this.fxTime;
    this.coinBurst(W - 80, clamp(ballY, 60, H - 60), gained);
    this.cb.onScore(this.pointsScored, this.cfg.pointsNeeded);
    this.cb.onCoins(this.totalCoins);
    if (this.pointsScored >= this.cfg.pointsNeeded) this.winMatch();
  }

  private onAIScore() {
    this.combo = 0;
    if (this.hasShield) {
      this.hasShield = false;
      this.sound.shield();
      this.flash("#facc15", 0.2);
      this.shake = motionAllowed() ? 5 : 0;
      this.cb.onShieldChange(false);
      this.texts.push({ x: 90, y: H / 2, vy: -30, t: 0, life: 0.9, text: "GUARD!", fill: "#fff", stroke: "#a16207", size: 20, pop: 0.5 });
      return;
    }
    this.foeHitAt = this.fxTime;
    this.hp--;
    this.sound.hurt();
    this.flash("#e04050", 0.25);
    this.shake = motionAllowed() ? 10 : 0;
    this.cb.onHurt(this.hp, this.maxHp);
    if (this.hp <= 0) this.loseMatch();
  }

  private winMatch() {
    this.matchOver = true;
    const bonus = 20 + this.cfg.round * 5;
    this.totalCoins += Math.round(bonus * this.cfg.coinMult);
    this.cb.onCoins(this.totalCoins);
    this.sound.levelUp();
    this.petRole = { role: "cheer", until: this.fxTime + 2 };
    this.texts.push({ x: W / 2, y: H / 2 - 20, vy: -10, t: 0, life: 1.4, text: "ROUND CLEAR!", fill: PAL.gold, stroke: "#9a3412", size: 44, pop: 0.6 });
    setTimeout(() => this.cb.onMatchWin(), 600);
  }

  private loseMatch() {
    this.matchOver = true;
    this.sound.gameOver();
    setTimeout(() => this.cb.onGameOver(), 900);
  }

  private resetBall() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const a = (Math.random() - 0.5) * Math.PI * 0.5;
    this.balls = [this.newBall(W / 2, H / 2, dir * this.ballSpeed * Math.cos(a), this.ballSpeed * Math.sin(a))];
  }

  private spawnPowerUps(dt: number) {
    this.powerUpSpawnTimer += dt * 1000;
    if (this.powerUpSpawnTimer >= this.nextPowerUpAt && this.powerUps.length < 2) {
      this.powerUpSpawnTimer = 0;
      this.nextPowerUpAt = (3000 + Math.random() * 3000) / this.cfg.powerupRateMult;
      this.powerUps.push({
        x: W / 2 + (Math.random() - 0.5) * 100,
        y: 60 + Math.random() * (H - 120),
        type: this.pickWeighted(POWERUP_TYPES, POWERUP_WEIGHTS),
        bob: Math.random() * Math.PI * 2,
        life: 8000,
        age: 0,
      });
    }
  }

  private spawnCreatures(dt: number) {
    this.creatureSpawnTimer += dt * 1000;
    if (this.creatureSpawnTimer >= this.nextCreatureAt && this.creatures.length < 3) {
      this.creatureSpawnTimer = 0;
      this.nextCreatureAt = 4000 + Math.random() * 4000;
      if (Math.random() < 0.65) this.spawnCreature();
    }
  }

  private spawnCreature() {
    const weights: Record<CreatureType, number> = { ghost: 40, demon: 25, blob: 25, fairy: 10 };
    const type = this.pickWeighted(["ghost", "demon", "blob", "fairy"] as CreatureType[], weights);
    const a = Math.random() * Math.PI * 2;
    const s = 30 + Math.random() * 40;
    this.creatures.push({
      x: W / 2 + (Math.random() - 0.5) * 200,
      y: 50 + Math.random() * (H - 100),
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      type, bob: Math.random() * Math.PI * 2, life: 8000, age: 0,
    });
  }

  private pickWeighted<T>(items: T[], weights: Record<string, number>): T {
    const total = items.reduce((s, item) => s + (weights[String(item)] ?? 0), 0);
    let r = Math.random() * total;
    for (const item of items) { r -= weights[String(item)] ?? 0; if (r <= 0) return item; }
    return items[0];
  }

  private updatePowerUps(dt: number) {
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      this.powerUps[i].bob += dt * 3;
      this.powerUps[i].age += dt;
      this.powerUps[i].life -= dt * 1000;
      if (this.powerUps[i].life <= 0) this.powerUps.splice(i, 1);
    }
  }

  private updateCreatures(dt: number) {
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.x += c.vx * dt; c.y += c.vy * dt; c.bob += dt * 3; c.age += dt;
      if (c.x < 20 || c.x > W - 20) c.vx *= -1;
      if (c.y < 20 || c.y > H - 20) c.vy *= -1;
      c.x = Math.max(20, Math.min(W - 20, c.x));
      c.y = Math.max(20, Math.min(H - 20, c.y));
      c.life -= dt * 1000;
      if (c.life <= 0) this.creatures.splice(i, 1);
    }
  }

  private addEffect(type: PowerUpType, duration: number) {
    this.effects = this.effects.filter((e) => e.type !== type);
    this.effects.push({ type, timeLeft: duration, duration });
  }

  private updateEffects(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].timeLeft -= dt * 1000;
      if (this.effects[i].timeLeft <= 0) {
        if (this.effects[i].type === "grow") this.player.h = this.paddleHeight;
        this.effects.splice(i, 1);
      }
    }
  }

  private updateAIEffect(dt: number) {
    if (this.aiEffectTimer > 0) {
      this.aiEffectTimer -= dt * 1000;
      if (this.aiEffectTimer <= 0) {
        this.ai.h = AI_BASE_HEIGHT;
        this.aiEffectType = "none";
        this.clampPaddle(this.ai);
      }
    }
  }

  private emit(x: number, y: number, color: string, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + 1;
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 400 + Math.random() * 300, maxLife: 700, color,
        size: 2 + Math.random() * 2.4, star: i % 3 === 0,
      });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  private updateParticlesStep(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95;
      p.life -= dt * 1000;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private flash(color: string, alpha: number) {
    if (!motionAllowed()) return;
    this.flashColor = color; this.flashAlpha = alpha;
  }

  // ── aim preview ────────────────────────────────────────────────────

  private getAimPreview(): { angle: number; y: number } | null {
    const incoming = this.balls.find((b) => b.vx < 0 && b.x <= W / 2);
    if (!incoming) return null;

    // Ball velocity is stored in per-frame units; predict in frames, not seconds.
    const paddleFaceX = this.player.x + this.player.w + incoming.r;
    const framesToReach = (incoming.x - paddleFaceX) / -incoming.vx;
    if (framesToReach <= 0 || framesToReach > 140) return null;

    let predY = incoming.y + incoming.vy * framesToReach;
    while (predY < 0 || predY > H) {
      if (predY < 0) predY = -predY;
      if (predY > H) predY = 2 * H - predY;
    }

    if (predY + incoming.r < this.player.y || predY - incoming.r > this.player.y + this.player.h) {
      return null;
    }

    const hitPos = (predY - (this.player.y + this.player.h / 2)) / (this.player.h / 2);
    const clamped = Math.max(-0.5, Math.min(0.5, hitPos));
    const curveBonus = this.cfg.curveball * 0.1;
    return { angle: clamped * Math.PI * 0.35 * (1 + curveBonus), y: predY };
  }

  // ── rendering ──────────────────────────────────────────────────────

  /** Arena art + darkening vignette, composited once per arena. */
  private ensureBackground() {
    const key = `${this.cfg.courtId}@${this.assets.hi}`;
    const img = this.assets.arena(this.cfg.courtId);
    if (this.bgCanvas && this.bgFor === `${key}:${img ? 1 : 0}`) return;
    const c = document.createElement("canvas");
    c.width = Math.round(W * this.dpr);
    c.height = Math.round(H * this.dpr);
    const g = c.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    if (img) {
      g.drawImage(img, 0, 0, W, H);
    } else {
      g.fillStyle = this.cfg.courtBg;
      g.fillRect(0, 0, W, H);
    }
    // readability: overall dim + vignette + a calmer centre lane
    g.fillStyle = "rgba(8,5,18,0.34)";
    g.fillRect(0, 0, W, H);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.62);
    v.addColorStop(0, "rgba(6,3,16,0)");
    v.addColorStop(1, "rgba(6,3,16,0.62)");
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    const edge = g.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, "rgba(4,2,12,0.55)");
    edge.addColorStop(0.14, "rgba(4,2,12,0)");
    edge.addColorStop(0.86, "rgba(4,2,12,0)");
    edge.addColorStop(1, "rgba(4,2,12,0.55)");
    g.fillStyle = edge;
    g.fillRect(0, 0, W, H);
    // gilded frame lines top and bottom
    g.fillStyle = "rgba(246,211,122,0.55)";
    g.fillRect(0, 0, W, 2);
    g.fillRect(0, H - 2, W, 2);
    this.bgCanvas = c;
    this.bgFor = `${key}:${img ? 1 : 0}`;
  }

  private blit(ctx: CanvasRenderingContext2D, s: LoadedSprite | undefined, cx: number, cy: number, scale: number, opts: { rot?: number; sx?: number; sy?: number; flip?: boolean; ax?: number; ay?: number; alpha?: number } = {}) {
    if (!s) return;
    const w = s.w * scale;
    const h = s.h * scale;
    const ax = opts.ax ?? s.def.anchor?.x ?? 0.5;
    const ay = opts.ay ?? s.def.anchor?.y ?? 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    if (opts.rot) ctx.rotate(opts.rot);
    ctx.scale((opts.flip ? -1 : 1) * (opts.sx ?? 1), opts.sy ?? 1);
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.drawImage(s.img, -ax * w, -ay * h, w, h);
    ctx.restore();
  }

  private render() {
    const ctx = this.ctx;
    const calm = motionAllowed();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const sx = this.shake > 0 && calm ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 && calm ? (Math.random() - 0.5) * this.shake : 0;

    this.ensureBackground();
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(FX_BLEED_X + sx, FX_BLEED_Y + sy);
    // Arena plate stays inside the gilded frame. Sprites and hit FX are not clipped to it.
    ctx.save();
    this.traceCourt(ctx);
    ctx.clip();
    ctx.fillStyle = this.cfg.courtBg;
    ctx.fillRect(0, 0, W, H);
    if (this.bgCanvas) ctx.drawImage(this.bgCanvas, 0, 0, W, H);
    ctx.restore();

    // The ambient layer belongs to the arena: keep it inside the plate, not in the FX bleed.
    ctx.save();
    this.traceCourt(ctx);
    ctx.clip();
    drawAmbient(ctx, this.ambient, H);
    ctx.restore();
    this.drawNameplates(ctx);
    this.drawRails(ctx);

    // power-ups
    for (const pu of this.powerUps) this.drawPowerUp(ctx, pu);
    // creatures
    for (const c of this.creatures) this.drawCreature(ctx, c);
    for (const d of this.dying) this.drawDying(ctx, d);

    // ball trails
    if (this.cfg.ballTrail) {
      for (const ball of this.balls) {
        for (let i = 0; i < ball.trail.length; i++) {
          const t = ball.trail[i];
          ctx.globalAlpha = (i / ball.trail.length) * 0.4;
          ctx.fillStyle = this.cfg.ballColor;
          ctx.beginPath(); ctx.arc(t.x, t.y, ball.r * (i / ball.trail.length), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // a miss travels behind the hilt instead of through it
    for (const ball of this.balls) if (this.ballBehindWeapon(ball)) this.drawBall(ctx, ball);

    // the familiar, in the margin beside the court
    this.drawPet(ctx);

    // time bubble
    if (this.timeBubbleTimer > 0) this.drawTimeBubble(ctx);

    // the familiar's shot crosses the court edge under the weapons, so it never covers the blade
    this.drawCastFx(ctx);

    // weapons (+ swing smear under the blade so the edge stays crisp)
    this.drawSmear(ctx, this.wp, this.player, false);
    this.drawSmear(ctx, this.wa, this.ai, true);
    this.drawWeapon(ctx, this.wp, this.player, false, this.cfg.paddleColor);
    this.drawWeapon(ctx, this.wa, this.ai, true, "#e04050");

    // shields
    if (this.hasShield) this.drawShield(ctx, this.wp, this.player, false, 0.9);
    if (this.aiHasShield) this.drawShield(ctx, this.wa, this.ai, true, 0.6);

    // active effect bars
    // stacked under the pommel, or over the tip when the weapon is at the bottom wall
    const ext = this.weaponExtent();
    const barsAbove = ext.bottom + 6 + this.effects.length * 8 > H - 4;
    const barStep = barsAbove ? -8 : 8;
    let eY = barsAbove ? ext.top - 8 : ext.bottom + 6;
    for (const e of this.effects) {
      const meta = POWERUP_META[e.type];
      const bw = 34;
      ctx.fillStyle = "rgba(10,6,24,0.7)";
      this.rrect(ctx, this.player.x - 3, eY - 1, bw + 2, 6, 3); ctx.fill();
      ctx.fillStyle = meta.color;
      this.rrect(ctx, this.player.x - 2, eY, Math.max(2, bw * (e.timeLeft / e.duration)), 4, 2); ctx.fill();
      eY += barStep;
    }

    // aim arrow
    const aim = this.getAimPreview();
    if (aim !== null) this.drawAim(ctx, aim);

    // balls still in the lane, over the weapons
    for (const ball of this.balls) if (!this.ballBehindWeapon(ball)) this.drawBall(ctx, ball);

    // coin pops
    for (const c of this.coinPops) {
      const a = 1 - Math.max(0, (c.t / c.life - 0.7) / 0.3);
      ctx.globalAlpha = a;
      drawCoin(ctx, c.x, c.y, 18, Math.abs(Math.cos(c.rot)) * 0.8 + 0.2);
    }
    ctx.globalAlpha = 1;

    // Hit FX are the top layer: above the familiar, weapons and balls, and outside
    // the court clip so a contact on the blade is fully on screen.
    for (const p of this.particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      if (p.star) drawStar(ctx, p.x, p.y, p.size * 1.5 * a + 0.5, this.fxTime * 3);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    this.drawLocalFlashes(ctx);
    this.drawAnims(ctx);
    if (calm) drawSpeedLines(ctx, this.lines);
    drawFloatTexts(ctx, this.texts);

    // get ready
    if (this.waitingForBall && !this.matchOver) {
      const pulse = 0.75 + 0.25 * Math.sin(this.fxTime * 5);
      drawJpText(ctx, "GET READY...", W / 2, H / 2 + 34, 24, "#fff4d6", "#6d28d9", pulse);
    }

    if (this.debug) this.drawDebug(ctx);

    ctx.restore();

    ctx.save();
    ctx.translate(FX_BLEED_X, FX_BLEED_Y);
    if ((this.paused || this.manualPause) && !this.matchOver) {
      ctx.fillStyle = "rgba(10,6,24,0.7)"; ctx.fillRect(0, 0, W, H);
      // A requested pause gets the DOM menu (Resume / Quit); a blur pause explains itself here.
      if (!this.manualPause) {
        drawJpText(ctx, "PAUSED", W / 2, H / 2 - 6, 44, PAL.gold, "#9a3412");
        ctx.font = `600 15px ${UI_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,244,214,0.7)";
        ctx.fillText("Click back in to resume", W / 2, H / 2 + 38);
      }
    }
    // Impact frame: the court, for one or two rendered steps. The local flash above lasts longer.
    if (this.impactWhite > 0 && calm) {
      ctx.fillStyle = "#ffffff"; ctx.globalAlpha = Math.min(1, this.impactWhite); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    if (this.flashAlpha > 0 && calm) {
      ctx.fillStyle = this.flashColor; ctx.globalAlpha = this.flashAlpha;
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Rounded court plate, in world pixels. Matches the CSS frame radius. */
  private traceCourt(ctx: CanvasRenderingContext2D) {
    const css = this.canvas.getBoundingClientRect().width || VIEW_W;
    const r = 12 * (VIEW_W / css);
    this.rrect(ctx, 0, 0, W, H, r);
  }

  /** World x of the blade face at rest. Misses and the familiar are placed against this. */
  private bladeFaceX(w: WeaponRt, paddle: Paddle, mirror: boolean) {
    const pose = poseForPaddle(w.geom, paddle, mirror, 0, w.recoil);
    return localToWorld(pose, w.geom.face, (w.geom.top + w.geom.bottom) * 0.5).x;
  }

  /** The ball has crossed the blade and should draw behind the weapon, not through the grip. */
  private ballBehindWeapon(ball: Ball) {
    if (ball.vx < 0 && ball.x < this.bladeFaceX(this.wp, this.player, false) - 2) return true;
    if (ball.vx > 0 && ball.x > this.bladeFaceX(this.wa, this.ai, true) + 2) return true;
    return false;
  }

  private drawLocalFlashes(ctx: CanvasRenderingContext2D) {
    for (const f of this.localFlashes) {
      const k = Math.max(0, 1 - f.t / f.life);
      const a = k * k;
      const radius = f.r * (0.65 + 0.55 * (1 - k));
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
      g.addColorStop(0, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
      g.addColorStop(0.28, `rgba(255,244,214,${(0.4 * a).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawNameplates(ctx: CanvasRenderingContext2D) {
    const plate = (x: number, text: string, color: string) => {
      ctx.save();
      ctx.translate(x, 22);
      ctx.fillStyle = "rgba(20,10,40,0.72)";
      this.rrect(ctx, -26, -11, 52, 22, 11); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = PAL.gold; ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `800 12px ${UI_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 1);
      ctx.restore();
    };
    plate(92, "P1", this.cfg.paddleColor);
    plate(W - 92, "FOE", "#ff7a8a");
  }

  private drawPowerUp(ctx: CanvasRenderingContext2D, pu: PowerUp) {
    const meta = POWERUP_META[pu.type];
    const py = pu.y + Math.sin(pu.bob) * 6;
    const fade = pu.life < 2000 ? (pu.life / 2000) * 0.7 + 0.3 : 1;
    const pop = pu.age < 0.25 ? 1 + 0.35 * Math.sin((pu.age / 0.25) * Math.PI) : 1;
    drawGlow(ctx, pu.x, py, 30, meta.color, 0.4 * fade);
    ctx.save();
    ctx.globalAlpha = fade;
    const s = this.assets.sprite(`powerup-${pu.type}`);
    const sc = 40 / (s?.h ?? 52);
    this.blit(ctx, s, pu.x, py, sc * pop, { rot: Math.sin(pu.bob * 0.7) * 0.06 });
    ctx.restore();
    // orbiting sparkles
    ctx.fillStyle = "#fff6c8";
    for (let i = 0; i < 3; i++) {
      const a = this.fxTime * 1.8 + pu.bob + (i * Math.PI * 2) / 3;
      const tw = 0.5 + 0.5 * Math.sin(this.fxTime * 7 + i * 2);
      ctx.globalAlpha = fade * tw;
      drawStar(ctx, pu.x + Math.cos(a) * 22, py + Math.sin(a) * 17, 2.6 + tw * 2, a);
    }
    ctx.globalAlpha = 1;
  }

  private drawCreature(ctx: CanvasRenderingContext2D, c: Creature) {
    const meta = CREATURE_META[c.type];
    const py = c.y + Math.sin(c.bob) * 4;
    const alpha = c.life < 2000 ? (c.life / 2000) * 0.7 + 0.3 : 1;
    const t = c.bob;
    const spawn = c.age < 0.3 ? c.age / 0.3 : 1;
    // ground shadow
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 34, 22 - Math.sin(c.bob) * 2, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const s = this.assets.sprite(`monster-${c.type}`);
    const sc = (c.type === "fairy" ? 77.5 : 72.5) / (s?.h ?? 84);
    const wob = Math.sin(t * 1.1 + c.x * 0.01) * 0.08;
    const sq = 1 + Math.sin(t * 2.2) * 0.045;
    ctx.save();
    ctx.globalAlpha = alpha * spawn;
    this.blit(ctx, s, c.x, py, sc * (0.6 + 0.4 * spawn), { rot: wob, sx: 1 / sq, sy: sq, flip: c.vx < 0 });
    ctx.restore();
    // name tag
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = "rgba(18,10,36,0.78)";
    this.rrect(ctx, c.x - 32, py + 31, 64, 12, 6); ctx.fill();
    ctx.fillStyle = meta.color;
    ctx.font = `800 8px ${UI_FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(meta.label, c.x, py + 37.5);
    ctx.globalAlpha = 1;
  }

  private drawDying(ctx: CanvasRenderingContext2D, d: Dying) {
    const s = this.assets.sprite(`monster-${d.type}`);
    const sc = 72.5 / (s?.h ?? 84);
    if (d.t < 0.2) {
      const k = d.t / 0.2;
      // hit flash: bright additive pass, squashed along the knock direction
      this.blit(ctx, s, d.x, d.y, sc * (1 + 0.15 * (1 - k)), { rot: d.rot * k, sx: 1 + 0.25 * (1 - k), sy: 1 - 0.2 * (1 - k), alpha: 1 - k * 0.5 });
      ctx.globalCompositeOperation = "lighter";
      this.blit(ctx, s, d.x, d.y, sc * (1 + 0.15 * (1 - k)), { rot: d.rot * k, sx: 1 + 0.25 * (1 - k), sy: 1 - 0.2 * (1 - k), alpha: 0.85 * (1 - k) });
      ctx.globalCompositeOperation = "source-over";
    }
    // poof frames at 24fps after the flash
    const pt = d.t - 0.12;
    if (pt >= 0) {
      const a = this.assets.animation("vfx-poof");
      if (a) {
        const idx = Math.floor(pt * 24);
        if (idx < a.frames.length) this.blit(ctx, this.assets.sprite(a.frames[idx]), d.x, d.y + 6, 78 / 128, { ax: 0.5, ay: 0.7 });
      }
    }
  }

  /** Visual top, bottom and front of the weapon at rest, tip to pommel, in world px. */
  private weaponExtent() {
    const g = this.wp.geom;
    const pose = poseForPaddle(g, this.player, false, 0, 0);
    return {
      top: Math.min(this.player.y, pose.py - g.ay * g.h * pose.scale),
      bottom: pose.py + (1 - g.ay) * g.h * pose.scale,
      /** Front-most x of the drawn sprite. */
      right: pose.px + (1 - g.ax) * g.w * pose.scale,
    };
  }

  /** Drawn size of the familiar, measured from its first frame. */
  private petMetrics() {
    if (this.petDims) return this.petDims;
    const anim = this.assets.animation(`pet-${this.cfg.pet}`);
    const s = anim ? this.assets.sprite(anim.frames[0]) : undefined;
    if (!s) return null;
    this.petDims = { w: s.w * (PET_DRAW_H / s.h), h: PET_DRAW_H };
    return this.petDims;
  }

  /** The gold frame's border in world px: it grows relative to the court as the window shrinks. */
  private frameGapWorld() {
    const css = this.canvas.getBoundingClientRect().width || VIEW_W;
    return 9 * (VIEW_W / css);
  }

  /**
   * The familiar lives in the margin beside the court: it strolls and hops along
   * the rail following the weapon, and for a cast it dashes to the frame edge.
   */
  private updatePet(dt: number) {
    const m = this.petMetrics();
    if (!m || dt <= 0) return;
    const b = railBounds({ petW: m.w, petH: m.h, feetAnchor: PET_FEET, courtH: H, frameGap: this.frameGapWorld() });
    const rest = railRest(b, this.player.y + this.player.h / 2, m.h, this.fxTime);
    if (!this.petReady) {
      this.petX = rest.x;
      this.petY = rest.y;
      this.petReady = true;
    }
    const px = this.petX;
    const py = this.petY;
    const cast = this.petCast;
    if (cast && this.petCastT < CAST_TOTAL + CAST_HOLD) {
      const ext = this.weaponExtent();
      const lane = castLane(ext.top, ext.bottom, b, m.h);
      const k = castDashProgress(this.petCastT);
      this.petX = cast.fromX + (b.xMax - cast.fromX) * k;
      this.petY = cast.fromY + (lane - cast.fromY) * k;
      if (!cast.muzzle && this.petCastT >= CAST_DASH) {
        cast.muzzle = true;
        const mouth = this.petMouth(m);
        this.emit(mouth.x, mouth.y, PETS[this.cfg.pet].color, 10, 3);
      }
    } else {
      this.petX += (rest.x - this.petX) * (1 - Math.exp(-dt * 6));
      this.petY += (rest.y - this.petY) * (1 - Math.exp(-dt * 9));
    }
    this.petX = clamp(this.petX, b.xMin, b.xMax);
    this.petY = clamp(this.petY, b.yMin, b.yMax);
    const speed = Math.min(900, Math.hypot(this.petX - px, this.petY - py) / dt);
    this.petSpeed += (speed - this.petSpeed) * 0.3;
    // look toward the ball: lean to its height, easing so it never snaps
    const ball = this.balls.reduce<Ball | null>((n, c) => (n === null || c.x < n.x ? c : n), null);
    const lean = ball ? clamp((ball.y - (this.petY - m.h * 0.42)) / 260, -1, 1) * 0.16 : 0;
    this.petTilt += (lean - this.petTilt) * (1 - Math.exp(-dt * 8));
  }

  /** Where the familiar's shot leaves it. */
  private petMouth(m: { w: number; h: number }): Pt {
    return { x: this.petX + m.w * 0.4, y: this.petY - m.h * 0.42 };
  }

  private drawPet(ctx: CanvasRenderingContext2D) {
    const animId = `pet-${this.cfg.pet}`;
    const anim = this.assets.animation(animId);
    const m = this.petMetrics();
    if (!anim || !m || !this.petReady) return;
    const roles = anim.roles ?? {};
    const now = this.fxTime;
    const casting = this.petCast !== null && this.petCastT < CAST_TOTAL + CAST_HOLD;
    let role = this.petRole.until > now ? this.petRole.role : "idle";
    if (casting) {
      role = this.petCastT < CAST_DASH ? "hop" : "cast";
    } else if (role === "idle") {
      // anticipation: the ball is on its way in
      const incoming = this.balls.some((b) => b.vx < 0 && b.x < W * 0.45);
      if (incoming && this.wp.predicted && this.wp.predicted.tau < 0.35) role = "windup";
      // it strolls and relocates in hops
      else if (this.petSpeed > 60 && Math.sin(now * 16) > 0) role = "hop";
    }
    const pick = (r: string): number => {
      const v = roles[r];
      if (Array.isArray(v)) return v[Math.floor(now * anim.fps) % v.length];
      return typeof v === "number" ? v : 0;
    };
    const s = this.assets.sprite(anim.frames[pick(role)]);
    if (!s) return;
    const sc = PET_DRAW_H / s.h;
    const x = this.petX;
    const ground = this.petY;

    // lifts: a hop on a hit, small arcs while it walks
    const calm = motionAllowed();
    const sinceHit = now - this.petHitAt;
    const hopLift = calm && sinceHit >= 0 && sinceHit < 0.34
      ? Math.sin(Math.PI * (sinceHit / 0.34)) * (this.petHitSweet ? 16 : 9)
      : 0;
    const stride = calm && this.petSpeed > 40 ? Math.abs(Math.sin(now * 13)) * Math.min(9, this.petSpeed * 0.06) : 0;
    const bob = Math.sin(now * 3.1) * 2.5;
    const feet = ground + bob - hopLift - stride;
    const air = Math.min(1, (hopLift + stride) / 16);

    // a soft pool of light under it, brighter while the ability is ready
    const ready = this.petCooldown <= 0;
    const tint = PETS[this.cfg.pet].color;
    drawGlow(ctx, x, ground + 2, 54, tint, ready ? 0.3 : 0.14);
    ctx.globalAlpha = 0.3 * (1 - air * 0.5);
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(x, ground + 1, 26 * (1 - air * 0.25), 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // a thin lit ledge under its feet, so it stands on something in the rail
    const ledge = ctx.createLinearGradient(x - 46, 0, x + 46, 0);
    ledge.addColorStop(0, "rgba(246,211,122,0)");
    ledge.addColorStop(0.5, `rgba(246,211,122,${0.5 - air * 0.25})`);
    ledge.addColorStop(1, "rgba(246,211,122,0)");
    ctx.fillStyle = ledge;
    ctx.fillRect(x - 46, ground + 2, 92, 2);

    const sq = Math.cos(this.petSquashT * 20) * Math.exp(-this.petSquashT * 6.5) * (this.petSquashT < 0.7 ? 1 : 0);
    // a dash stretches along its run, a cast squashes in
    const dash = casting && this.petCastT < CAST_DASH ? 0.2 : 0;
    const sx = 1 + sq * 0.22 + dash;
    const sy = 1 - sq * 0.22 - dash * 0.6;
    const tilt = calm ? this.petTilt : 0;
    if (this.cfg.pet === "bat" && anim.wings) {
      this.drawBat(ctx, s, x, feet, sc, sx, sy, anim.wings, Math.sin(now * 14) * 0.16, role === "cast" ? 0.5 : 0, tilt);
    } else {
      // pets face the court (the art faces left)
      this.blit(ctx, s, x, feet, sc, { flip: true, sx, sy, ax: 0.5, ay: PET_FEET, rot: tilt });
    }

    // ready indicator
    if (ready) {
      const t = now * 4;
      ctx.fillStyle = "#fff1a8";
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t);
      drawStar(ctx, x + (s.w * sc) * 0.35, feet - 86 + Math.sin(t) * 2, 5, t * 0.3);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * One rail panel, built once per arena/size: a slab of the arena's own wall,
   * mirrored outward so it reads as more of the room, dimmed toward the window
   * edge, with a gold trim that echoes the court's frame. `side` -1 is the
   * familiar's rail on the left, +1 the foe's on the right.
   */
  private buildRail(side: -1 | 1, w: number): HTMLCanvasElement {
    const pad = 4;
    const c = document.createElement("canvas");
    c.width = Math.round((w + pad * 2) * this.dpr);
    c.height = Math.round((H + pad * 2) * this.dpr);
    const g = c.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    g.translate(pad, pad);
    g.save();
    this.rrect(g, 0, 0, w, H, 10);
    g.clip();
    g.fillStyle = "#0a0518";
    g.fillRect(0, 0, w, H);
    const img = this.assets.arena(this.cfg.courtId);
    if (img) {
      // local x maps to the arena's x mirrored about the court wall
      g.save();
      g.translate(side < 0 ? w : W, 0);
      g.scale(-1, 1);
      g.globalAlpha = 0.85;
      g.drawImage(img, 0, 0, W, H);
      g.restore();
    }
    // dim toward the window edge, and top and bottom, so the court stays the brightest thing
    const across = side < 0 ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(w, 0, 0, 0);
    across.addColorStop(0, "rgba(8,4,20,0.82)");
    across.addColorStop(1, "rgba(8,4,20,0.42)");
    g.fillStyle = across;
    g.fillRect(0, 0, w, H);
    const down = g.createLinearGradient(0, 0, 0, H);
    down.addColorStop(0, "rgba(4,2,12,0.6)");
    down.addColorStop(0.18, "rgba(4,2,12,0)");
    down.addColorStop(0.82, "rgba(4,2,12,0)");
    down.addColorStop(1, "rgba(4,2,12,0.6)");
    g.fillStyle = down;
    g.fillRect(0, 0, w, H);
    // a faint warm wash on the court side, like light spilling off the frame
    const spill = side < 0 ? g.createLinearGradient(w, 0, w - 26, 0) : g.createLinearGradient(0, 0, 26, 0);
    spill.addColorStop(0, "rgba(246,211,122,0.16)");
    spill.addColorStop(1, "rgba(246,211,122,0)");
    g.fillStyle = spill;
    g.fillRect(0, 0, w, H);
    g.restore();

    // trim: dark outline, gold band, light inner edge (the court frame's recipe, scaled down)
    g.lineJoin = "round";
    g.strokeStyle = "#2a1604";
    g.lineWidth = 3.4;
    this.rrect(g, -0.2, -0.2, w + 0.4, H + 0.4, 10);
    g.stroke();
    g.strokeStyle = "#b98a2e";
    g.lineWidth = 1.8;
    this.rrect(g, 0.2, 0.2, w - 0.4, H - 0.4, 10);
    g.stroke();
    g.strokeStyle = "rgba(255,236,170,0.3)";
    g.lineWidth = 0.8;
    this.rrect(g, 1.6, 1.6, w - 3.2, H - 3.2, 8.6);
    g.stroke();
    return c;
  }

  /** Rail panel rectangles in world px: the familiar's on the left, the foe's on the right. */
  private railRects() {
    const gap = this.frameGapWorld();
    const lx0 = -(PET_RAIL_W - 4);
    const lx1 = -(gap + 2);
    const rx0 = W + gap + 2;
    const rx1 = W + FOE_RAIL_W - 4;
    return { left: { x: lx0, w: lx1 - lx0 }, right: { x: rx0, w: rx1 - rx0 } };
  }

  /** The docks beside the court: the familiar's, and a slimmer one for the foe's guardian. */
  private drawRails(ctx: CanvasRenderingContext2D) {
    const r = this.railRects();
    const key = `${this.bgFor}|${Math.round(r.left.w)}|${Math.round(r.right.w)}|${this.dpr}`;
    if (!this.railCache || this.railCache.key !== key) {
      this.railCache = { key, left: this.buildRail(-1, r.left.w), right: this.buildRail(1, r.right.w) };
    }
    const pad = 4;
    ctx.drawImage(this.railCache.left, r.left.x - pad, -pad, r.left.w + pad * 2, H + pad * 2);
    ctx.drawImage(this.railCache.right, r.right.x - pad, -pad, r.right.w + pad * 2, H + pad * 2);
    this.drawFoeGuardian(ctx, r.right.x, r.right.w);
  }

  /**
   * The foe's guardian stands in its rail: bobs when idle, cheers when the foe
   * returns or scores, flinches when a point lands on it. Under it, the foe's
   * level (the round) as a small gauge, so the rail carries status as well as art.
   */
  private drawFoeGuardian(ctx: CanvasRenderingContext2D, x0: number, w: number) {
    const s = this.assets.sprite("monster-demon");
    if (!s) return;
    const now = this.fxTime;
    const calm = motionAllowed();
    const cx = x0 + w / 2;
    const ground = H * 0.7;
    // inset from the trim so the flame never touches it, even in the narrow layout
    const sc = Math.min((w * 0.74) / s.w, 78 / s.h);
    const cheerT = now - this.foeHitAt;
    const flinchT = now - this.foeFlinchAt;
    const hop = calm && cheerT >= 0 && cheerT < 0.3 ? Math.sin(Math.PI * (cheerT / 0.3)) * 9 : 0;
    const hurt = calm && flinchT >= 0 && flinchT < 0.45 ? Math.exp(-flinchT * 7) * Math.cos(flinchT * 38) : 0;
    const bob = calm ? Math.sin(now * 2.3) * 2.2 : 0;
    const tint = "#ff5a7a";
    drawGlow(ctx, cx, ground + 2, w * 0.8, tint, 0.2 + (flinchT >= 0 && flinchT < 0.3 ? 0.25 : 0));
    ctx.globalAlpha = 0.3 * (1 - Math.min(1, hop / 12) * 0.5);
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(cx, ground + 1, w * 0.36, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const sq = hurt * 0.2;
    this.blit(ctx, s, cx + hurt * 3, ground + bob - hop, sc, { sx: 1 + sq, sy: 1 - sq, ax: 0.5, ay: 0.96, rot: hurt * 0.12 });

    // level gauge
    const level = this.cfg.round;
    const gy = ground + 20;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 10px ${UI_FONT}`;
    ctx.fillStyle = "#ffb3bf";
    ctx.fillText(`LV ${String(level).padStart(2, "0")}`, cx, gy);
    const bw = w * 0.66;
    ctx.fillStyle = "rgba(10,5,24,0.85)";
    this.rrect(ctx, cx - bw / 2, gy + 9, bw, 6, 3); ctx.fill();
    ctx.fillStyle = tint;
    this.rrect(ctx, cx - bw / 2 + 1, gy + 10, Math.max(4, (bw - 2) * Math.min(1, level / 12)), 4, 2); ctx.fill();
    ctx.strokeStyle = "rgba(246,211,122,0.6)";
    ctx.lineWidth = 1;
    this.rrect(ctx, cx - bw / 2, gy + 9, bw, 6, 3); ctx.stroke();
    ctx.restore();
  }

  /** The shot from the familiar to where its ability lands. Drawn under the weapons. */
  private drawCastFx(ctx: CanvasRenderingContext2D) {
    const cast = this.petCast;
    const m = this.petMetrics();
    if (!cast || !m || this.petCastT < CAST_DASH || this.petCastT > CAST_TOTAL + 0.05) return;
    const u = castFlightProgress(this.petCastT);
    const from = this.petMouth(m);
    const to = this.castOrigin();
    const right = this.weaponExtent().right;
    const color = PETS[this.cfg.pet].color;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const fade = u >= 1 ? 1 - (this.petCastT - CAST_TOTAL) / 0.05 : 1;
    for (let i = 6; i >= 0; i--) {
      const p = castPath(from, to, right, Math.max(0, u - i * 0.07));
      const k = 1 - i / 7;
      drawGlow(ctx, p.x, p.y, 8 + 14 * k, color, 0.7 * k * fade);
    }
    const head = castPath(from, to, right, u);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(head.x, head.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    drawStar(ctx, head.x, head.y, 9, this.fxTime * 12);
    ctx.restore();
  }

  /** Bat: wings flap procedurally on top of the authored frames. */
  private drawBat(ctx: CanvasRenderingContext2D, s: LoadedSprite, x: number, feet: number, sc: number, sx: number, sy: number, wings: { left: number; right: number; shoulderY: number }, flap: number, lift: number, tilt = 0) {
    const iw = s.img.naturalWidth;
    const ih = s.img.naturalHeight;
    const dw = s.w * sc;
    const dh = s.h * sc;
    const dx = -dw / 2;
    const dy = -dh * 0.96;
    ctx.save();
    ctx.translate(x, feet - lift * 10);
    ctx.rotate(tilt);
    ctx.scale(sx, sy);
    const xl = wings.left * iw;
    const xr = wings.right * iw;
    const lx = dx + wings.left * dw;
    const rx = dx + wings.right * dw;
    const sh = dy + wings.shoulderY * dh;
    const ov = 3; // px of overlap tucked under the body
    // left wing (the art's far wing), pivots at the shoulder
    ctx.save();
    ctx.translate(lx, sh);
    ctx.rotate(-flap);
    ctx.drawImage(s.img, 0, 0, xl + ov, ih, dx - lx, dy - sh, lx - dx + ov * (dw / iw), dh);
    ctx.restore();
    ctx.save();
    ctx.translate(rx, sh);
    ctx.rotate(flap);
    ctx.drawImage(s.img, xr - ov, 0, iw - xr + ov, ih, -ov * (dw / iw), dy - sh, dx + dw - rx + ov * (dw / iw), dh);
    ctx.restore();
    ctx.drawImage(s.img, xl, 0, xr - xl, ih, lx, dy, rx - lx, dh);
    ctx.restore();
  }

  private drawTimeBubble(ctx: CanvasRenderingContext2D) {
    const pct = this.timeBubbleTimer / 2.2;
    const cx = this.player.x + this.player.w + 58;
    const cy = this.player.y + this.player.h / 2;
    const pulse = Math.sin(this.fxTime * 12) * 3;
    // pops in as the familiar's shot lands
    const pop = Math.min(1, (2.2 - this.timeBubbleTimer) / 0.14);
    const r = Math.max(1, (90 + pulse) * (1 - (1 - pop) ** 3));
    ctx.save();
    const g = ctx.createRadialGradient(cx - 20, cy - 30, 8, cx, cy, r);
    g.addColorStop(0, `rgba(160,255,225,${0.1 + pct * 0.1})`);
    g.addColorStop(0.8, `rgba(80,220,180,${0.14 + pct * 0.14})`);
    g.addColorStop(1, `rgba(140,255,230,${0.3 + pct * 0.2})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(190,255,238,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 9]);
    ctx.lineDashOffset = -this.fxTime * 30;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    // rune ticks drifting round the rim
    ctx.fillStyle = "#e9fff8";
    for (let i = 0; i < 6; i++) {
      const a = this.fxTime * 0.7 + (i * Math.PI) / 3;
      drawStar(ctx, cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6), 3.2, a);
    }
    ctx.restore();
    // beside the field, not above it: the familiar rides above the weapon tip
    drawJpText(ctx, "TIME BUBBLE", cx + r + 46, cy, 12, "#c8fff0", "#0f766e", 0.9, 0);
  }

  private drawWeapon(ctx: CanvasRenderingContext2D, w: WeaponRt, paddle: Paddle, mirror: boolean, glow: string) {
    const s = this.assets.sprite(w.spriteId);
    const pose = this.weaponPose(w, paddle, mirror);
    // faint aura along the blade, brighter on a sweet hit
    const mid = localToWorld(pose, w.geom.face * 0.5, (w.geom.top + w.geom.bottom) / 2);
    drawGlow(ctx, mid.x, mid.y, paddle.h * 0.62, glow, 0.26 + w.sweetFlash * 0.35);
    if (!s) {
      // sprite missing: still show the true hit zone so the game stays playable
      ctx.fillStyle = glow;
      for (const poly of worldZone(w.geom, pose)) {
        ctx.beginPath();
        poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    const sc = pose.scale;
    const ax = w.geom.ax;
    const ay = w.geom.ay;
    const dx = -ax * s.w * sc;
    const dy = -ay * s.h * sc;
    const dw = s.w * sc;
    const dh = s.h * sc;
    ctx.save();
    ctx.translate(pose.px, pose.py);
    ctx.rotate(pose.angle);
    if (mirror) ctx.scale(-1, 1);
    // Dark rim plus a soft glow in the weapon colour. Thin swords disappear on dark arenas without it.
    ctx.filter = `drop-shadow(1.4px 0 0 rgba(16,8,12,0.95)) drop-shadow(-1.4px 0 0 rgba(16,8,12,0.95)) drop-shadow(0 1.4px 0 rgba(16,8,12,0.95)) drop-shadow(0 -1.4px 0 rgba(16,8,12,0.95)) drop-shadow(0 0 2.5px ${glow})`;
    ctx.drawImage(s.img, dx, dy, dw, dh);
    ctx.filter = "none";
    ctx.drawImage(s.img, dx, dy, dw, dh);
    if (w.sweetFlash > 0.05) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = w.sweetFlash * 0.7;
      ctx.drawImage(s.img, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  /** Crescent smear following the blade's real arc (frames from the VFX sheet). */
  private drawSmear(ctx: CanvasRenderingContext2D, w: WeaponRt, paddle: Paddle, mirror: boolean) {
    if (w.smearT < 0) return;
    const anim = this.assets.animation("vfx-smear");
    if (!anim) return;
    const idx = Math.floor(w.smearT * 30);
    if (idx < 0 || idx >= anim.frames.length) return;
    const s = this.assets.sprite(anim.frames[idx]);
    if (!s) return;
    const a0 = w.smearA0;
    const a1 = Math.max(w.smearA1, a0 + 0.35);
    const mid = (a0 + a1) / 2;
    const pose = this.weaponPose(w, paddle, mirror);
    const dir = mirror ? -1 : 1;
    const R = -w.geom.top * pose.scale * 0.95; // grip -> tip: the radius the tip sweeps
    const chord = 2 * R * Math.sin((a1 - a0) / 2);
    const scale = clamp(chord / (s.h * 0.78), 0.2, 1.4);
    // The crescent's convex edge (+x in sprite space) rides the tip's path.
    const phi = dir * mid - Math.PI / 2;
    const off = R - 0.4 * s.w * scale;
    const bx = pose.px + dir * Math.sin(mid) * off;
    const by = pose.py - Math.cos(mid) * off;
    const alpha = 1 - clamp((w.smearT - 0.1) / 0.1, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.92 * alpha;
    ctx.translate(bx, by);
    ctx.rotate(phi);
    ctx.drawImage(s.img, -s.w * scale * 0.5, -s.h * scale * 0.5, s.w * scale, s.h * scale);
    ctx.restore();
  }

  private drawShield(ctx: CanvasRenderingContext2D, w: WeaponRt, paddle: Paddle, mirror: boolean, a: number) {
    const x = mirror ? paddle.x - 8 : paddle.x + paddle.w + 8;
    const cy = paddle.y + paddle.h / 2;
    const hh = paddle.h / 2 + 14;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = a * (0.55 + 0.15 * Math.sin(this.fxTime * 6));
    const g = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
    g.addColorStop(0, "rgba(255,220,100,0)");
    g.addColorStop(0.5, "rgba(255,230,140,0.55)");
    g.addColorStop(1, "rgba(255,220,100,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, cy, 12, hh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffe9a0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, cy, 9, hh, 0, mirror ? Math.PI * 0.5 : -Math.PI * 0.5, mirror ? Math.PI * 1.5 : Math.PI * 0.5);
    ctx.stroke();
    ctx.restore();
    void w;
  }

  private drawAim(ctx: CanvasRenderingContext2D, aim: { angle: number; y: number }) {
    const cx = this.player.x + this.player.w + 10;
    const cy = aim.y;
    const len = 40;
    const ex = cx + Math.cos(aim.angle) * len;
    const ey = cy + Math.sin(aim.angle) * len;
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(20,8,40,0.6)";
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    const hx = ex + Math.cos(aim.angle) * 7;
    const hy = ey + Math.sin(aim.angle) * 7;
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex - Math.sin(aim.angle) * 6, ey + Math.cos(aim.angle) * 6);
    ctx.lineTo(ex + Math.sin(aim.angle) * 6, ey - Math.cos(aim.angle) * 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
    const id = BALL_SKINS[this.cfg.ballId] ? this.cfg.ballId : BALL_ID_FALLBACK;
    const s = this.assets.sprite(`ball-${id}`);
    const speed = Math.hypot(ball.vx, ball.vy);

    // outgoing speed streak after a hit
    if (ball.sinceHit < 0.28 && speed > 0.1) {
      const k = 1 - ball.sinceHit / 0.28;
      const len = Math.min(110, speed * 5.5) * (0.5 + 0.5 * k);
      const ux = -ball.vx / speed;
      const uy = -ball.vy / speed;
      const g = ctx.createLinearGradient(ball.x, ball.y, ball.x + ux * len, ball.y + uy * len);
      g.addColorStop(0, "rgba(255,255,255,0.75)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = g;
      ctx.lineCap = "round";
      ctx.lineWidth = ball.r * 1.5;
      ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(ball.x + ux * len, ball.y + uy * len); ctx.stroke();
      ctx.restore();
    }

    drawGlow(ctx, ball.x, ball.y, ball.r * 3.4, this.cfg.ballColor, 0.5);

    // squash along the contact normal, then stretch along the way out
    let sa = 1;
    let sp = 1;
    let axis = Math.atan2(ball.vy, ball.vx);
    if (ball.sinceHit < 0.2) {
      const t = ball.sinceHit;
      if (t < 0.05) {
        const k = Math.sin((t / 0.05) * (Math.PI / 2));
        sa = 1 - 0.42 * k;
        sp = 1 + 0.3 * k;
        axis = Math.atan2(ball.hitNy, ball.hitNx);
      } else {
        const k = 1 - (t - 0.05) / 0.15;
        sa = 1 + 0.5 * k * k;
        sp = 1 - 0.22 * k * k;
      }
    }

    if (!s) {
      ctx.fillStyle = this.cfg.ballColor;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const orb = s.def.orb ?? { x: 0.5, y: 0.5, r: 0.4 };
    const dw = ball.r / orb.r;
    const dh = (dw * s.h) / s.w;
    let spriteRot = ball.spin * 0.6;
    if (id === "comet" && speed > 0.1) {
      // the flame trails behind the direction of travel
      const tail = Math.atan2((0.5 - orb.y) * s.h, (0.5 - orb.x) * s.w);
      spriteRot = Math.atan2(-ball.vy, -ball.vx) - tail;
    } else if (id === "classic") {
      spriteRot = ball.spin * 0.25;
    }
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(axis);
    ctx.scale(sa, sp);
    ctx.rotate(spriteRot - axis);
    ctx.drawImage(s.img, -orb.x * dw, -orb.y * dh, dw, dh);
    ctx.restore();
  }

  private drawAnims(ctx: CanvasRenderingContext2D) {
    for (const a of this.anims) {
      const def = MANIFEST.animations[a.anim];
      if (!def) continue;
      const idx = Math.min(def.frames.length - 1, Math.floor(a.t * a.fps));
      const s = this.assets.sprite(def.frames[idx]);
      if (!s) continue;
      ctx.save();
      if (a.additive) ctx.globalCompositeOperation = "lighter";
      this.blit(ctx, s, a.x, a.y, a.scale, { rot: a.rot, alpha: a.alpha, ax: 0.5, ay: 0.5 });
      ctx.restore();
    }
  }

  // ── debug overlay ──────────────────────────────────────────────────

  private drawDebug(ctx: CanvasRenderingContext2D) {
    const weapons: Array<[WeaponRt, Paddle, boolean]> = [[this.wp, this.player, false], [this.wa, this.ai, true]];
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const [w, paddle, mirror] of weapons) {
      const pose = this.weaponPose(w, paddle, mirror);
      // hit zone
      ctx.fillStyle = "rgba(60,255,120,0.22)";
      ctx.strokeStyle = "rgba(60,255,120,0.95)";
      for (const poly of worldZone(w.geom, pose)) {
        ctx.beginPath();
        poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // logical paddle rect (the original collision box)
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(80,200,255,0.9)";
      ctx.strokeRect(paddle.x, paddle.y, paddle.w, paddle.h);
      ctx.setLineDash([]);
      // sweet band along the weapon axis
      const t0 = w.geom.top + (w.geom.bottom - w.geom.top) * (w.geom.sweetV - w.geom.sweetHalf);
      const t1 = w.geom.top + (w.geom.bottom - w.geom.top) * (w.geom.sweetV + w.geom.sweetHalf);
      const dir = mirror ? -1 : 1;
      const at = (ly: number, lx: number) => ({
        x: pose.px + dir * lx * pose.scale * Math.cos(pose.angle) - ly * pose.scale * Math.sin(pose.angle),
        y: pose.py + dir * lx * pose.scale * Math.sin(pose.angle) + ly * pose.scale * Math.cos(pose.angle),
      });
      const p0 = at(t0, w.geom.face);
      const p1 = at(t1, w.geom.face);
      ctx.strokeStyle = "#ffe14a";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      ctx.lineWidth = 1.5;
      // grip pivot
      ctx.strokeStyle = "#ff4fd8";
      ctx.beginPath();
      ctx.moveTo(pose.px - 6, pose.py); ctx.lineTo(pose.px + 6, pose.py);
      ctx.moveTo(pose.px, pose.py - 6); ctx.lineTo(pose.px, pose.py + 6);
      ctx.stroke();
      // predicted contact
      if (w.predicted) {
        const p = w.predicted;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(p.x - 7, p.y - 7); ctx.lineTo(p.x + 7, p.y + 7);
        ctx.moveTo(p.x + 7, p.y - 7); ctx.lineTo(p.x - 7, p.y + 7);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "10px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(`tau ${(p.tau * 1000).toFixed(0)}ms${p.sweet ? " SWEET" : ""}`, p.x + 9, p.y - 6);
      }
    }
    // balls
    ctx.strokeStyle = "#ff4fd8";
    for (const b of this.balls) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    // recent contacts + normals
    for (const c of this.contacts) {
      const age = this.fxTime - c.t;
      ctx.globalAlpha = Math.max(0.15, 1 - age / 2.5);
      ctx.fillStyle = c.sweet ? "#ffe14a" : "#ff5a5a";
      ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + c.nx * 14, c.y + c.ny * 14); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(6, H - 56, 250, 50);
    ctx.fillStyle = "#9dff9d";
    ctx.font = "11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`HIT ZONES  [H] to hide   ${(1000 / this.frameMs).toFixed(0)} fps`, 12, H - 40);
    ctx.fillText(`green=zone  cyan=old paddle box  yellow=sweet`, 12, H - 26);
    ctx.fillText(`hitstop ${(this.hitStop * 1000).toFixed(0)}ms  combo ${this.combo}`, 12, H - 12);
    ctx.restore();
  }

  private rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
