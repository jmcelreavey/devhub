"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================
// TYPES
// ============================================================

type Phase = "hidden" | "menu" | "playing" | "draft" | "gameover" | "shop";

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  trail: { x: number; y: number }[];
}

type PowerUpType = "grow" | "multiball" | "slowmo" | "shield" | "heart";

interface PowerUp {
  x: number;
  y: number;
  type: PowerUpType;
  bob: number;
  life: number;
}

type CreatureType = "ghost" | "demon" | "fairy" | "blob";
type PetType = "turtle" | "bat" | "dragon";

interface Creature {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: CreatureType;
  bob: number;
  life: number;
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
}

interface ActiveEffect {
  type: PowerUpType;
  timeLeft: number;
  duration: number;
}

interface Paddle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MatchConfig {
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
  ballColor: string;
  ballTrail: boolean;
  ballGlow: string;
  courtBg: string;
  courtGrid: string;
  courtLine: string;
}

interface GameCallbacks {
  onScore: (points: number, needed: number) => void;
  onHurt: (hp: number, maxHp: number) => void;
  onHeal: (hp: number, maxHp: number) => void;
  onShieldChange: (hasShield: boolean) => void;
  onCoins: (total: number) => void;
  onAbility: (slowMeter: number, petCooldown: number) => void;
  onMatchWin: () => void;
  onGameOver: () => void;
}

interface SaveData {
  coins: number;
  ownedPaddles: string[];
  ownedBalls: string[];
  ownedCourts: string[];
  equippedPaddle: string;
  equippedBall: string;
  equippedCourt: string;
  ownedPets: string[];
  equippedPet: PetType;
  upgrades: Record<string, number>;
  bestRound: number;
  totalRuns: number;
  totalCoins: number;
  muted: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

const W = 800;
const H = 500;
const AI_BASE_HEIGHT = 80;

const PADDLE_SKINS: Record<string, { name: string; price: number; color: string; glow: string }> = {
  classic: { name: "IRON SWORD", price: 0, color: "#d4cfa8", glow: "rgba(212,207,168,0.3)" },
  neon: { name: "MITHRIL BLADE", price: 150, color: "#6bb6ff", glow: "rgba(107,182,255,0.3)" },
  inferno: { name: "BATTLE AXE", price: 200, color: "#f97316", glow: "rgba(249,115,22,0.3)" },
  matrix: { name: "WAR HAMMER", price: 150, color: "#22c55e", glow: "rgba(34,197,94,0.3)" },
  royal: { name: "ARCANE STAFF", price: 200, color: "#a855f7", glow: "rgba(168,85,247,0.3)" },
  gold: { name: "GOLDEN SWORD", price: 500, color: "#fbbf24", glow: "rgba(251,191,36,0.4)" },
};

const BALL_SKINS: Record<string, { name: string; price: number; color: string; trail: boolean; glow: string }> = {
  classic: { name: "CLASSIC", price: 0, color: "#f8fafc", trail: false, glow: "rgba(248,250,252,0.4)" },
  comet: { name: "COMET", price: 150, color: "#fbbf24", trail: true, glow: "rgba(251,191,36,0.7)" },
  plasma: { name: "PLASMA", price: 200, color: "#e879f9", trail: true, glow: "rgba(232,121,249,0.7)" },
  ice: { name: "ICE", price: 200, color: "#67e8f9", trail: true, glow: "rgba(103,232,249,0.7)" },
  void: { name: "VOID", price: 500, color: "#e04050", trail: true, glow: "rgba(224,64,80,0.8)" },
};

const COURT_SKINS: Record<string, { name: string; price: number; bg: string; grid: string; line: string }> = {
  midnight: { name: "STONE KEEP", price: 0, bg: "#1a1520", grid: "rgba(70,55,30,0.12)", line: "rgba(100,80,50,0.2)" },
  synthwave: { name: "ENCHANTED", price: 200, bg: "#0d1a12", grid: "rgba(40,70,30,0.12)", line: "rgba(60,110,50,0.2)" },
  terminal: { name: "GLOOM CAVE", price: 150, bg: "#1a1408", grid: "rgba(60,50,20,0.15)", line: "rgba(100,80,30,0.2)" },
  sunset: { name: "LAVA PIT", price: 200, bg: "#1e0a0a", grid: "rgba(80,30,20,0.12)", line: "rgba(150,60,30,0.2)" },
  deep: { name: "ABYSS", price: 300, bg: "#0a0f1a", grid: "rgba(30,50,80,0.12)", line: "rgba(50,80,120,0.2)" },
};

const PETS: Record<PetType, { name: string; price: number; color: string; desc: string }> = {
  turtle: { name: "TIME TURTLE", price: 0, color: "#34d399", desc: "LEFT CLICK: paddle time bubble" },
  bat: { name: "BATSY", price: 250, color: "#a78bfa", desc: "LEFT CLICK: spawn helper ball" },
  dragon: { name: "SPARK DRAGON", price: 400, color: "#e04050", desc: "LEFT CLICK: launch balls faster" },
};

interface PerkDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  maxStacks: number;
}

const PERKS: PerkDef[] = [
  { id: "bigRacket", name: "BIG RACKET", desc: "+20% paddle size", icon: "[]", maxStacks: 5 },
  { id: "slowBall", name: "HEAVY BALL", desc: "-8% ball speed", icon: "##", maxStacks: 5 },
  { id: "powerUp", name: "LUCKY STRIKE", desc: "+40% power-up rate", icon: "+P", maxStacks: 3 },
  { id: "greedy", name: "GOLDEN TOUCH", desc: "+30% coins", icon: "$$", maxStacks: 3 },
  { id: "secondWind", name: "SECOND WIND", desc: "Shield at start", icon: "SH", maxStacks: 1 },
  { id: "tanky", name: "TANK", desc: "+1 max HP", icon: "HP", maxStacks: 3 },
  { id: "curveball", name: "CURVEBALL", desc: "Sharper angles", icon: "~~", maxStacks: 3 },
];

interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  basePrice: number;
  maxLevel: number;
  priceMult: number;
}

const UPGRADES: UpgradeDef[] = [
  { id: "startHp", name: "VITALITY", desc: "+1 starting HP", basePrice: 200, maxLevel: 2, priceMult: 2 },
  { id: "coinBoost", name: "COIN MAGNET", desc: "+10% coins", basePrice: 100, maxLevel: 5, priceMult: 1.5 },
  { id: "powerupFreq", name: "FORTUNE", desc: "+15% power-up rate", basePrice: 150, maxLevel: 3, priceMult: 1.8 },
];

const POWERUP_META: Record<PowerUpType, { color: string; icon: string; label: string }> = {
  grow: { color: "#22c55e", icon: "+", label: "GROW" },
  multiball: { color: "#f97316", icon: "*", label: "MULTI" },
  slowmo: { color: "#3b82f6", icon: "~", label: "SLOW" },
  shield: { color: "#facc15", icon: "#", label: "SHIELD" },
  heart: { color: "#ec4899", icon: "+", label: "HP+" },
};

const POWERUP_TYPES: PowerUpType[] = ["grow", "multiball", "slowmo", "shield", "heart"];
const POWERUP_WEIGHTS: Record<PowerUpType, number> = {
  grow: 25, multiball: 20, slowmo: 20, shield: 20, heart: 8,
};

const CREATURE_META: Record<CreatureType, { color: string; icon: string; label: string }> = {
  ghost: { color: "#a78bfa", icon: "G", label: "COIN GHOST" },
  demon: { color: "#ef4444", icon: "D", label: "SPEED DEMON" },
  fairy: { color: "#34d399", icon: "F", label: "HEAL FAIRY" },
  blob: { color: "#f59e0b", icon: "?", label: "CHAOS BLOB" },
};

// ============================================================
// SAVE / LOAD
// ============================================================

const SAVE_KEY = "konami-pong-v1";

function defaultSave(): SaveData {
  return {
    coins: 0, ownedPaddles: ["classic"], ownedBalls: ["classic"], ownedCourts: ["midnight"],
    equippedPaddle: "classic", equippedBall: "classic", equippedCourt: "midnight",
    ownedPets: ["turtle"], equippedPet: "turtle",
    upgrades: {}, bestRound: 0, totalRuns: 0, totalCoins: 0, muted: false,
  };
}

function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return { ...defaultSave(), ...JSON.parse(raw) };
  } catch {
    return defaultSave();
  }
}

function persistSave(data: SaveData) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* noop */ }
}

// ============================================================
// SOUND ENGINE
// ============================================================

class SoundEngine {
  private ctx: AudioContext | null = null;
  muted = false;

  ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  blip(freq: number, dur: number, type: OscillatorType = "square", gain = 0.06) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur);
  }

  paddle() { this.blip(440, 0.04, "square", 0.05); }
  wall() { this.blip(220, 0.03, "square", 0.03); }
  score() { this.blip(660, 0.08, "sine", 0.08); setTimeout(() => this.blip(880, 0.12, "sine", 0.08), 60); }
  hurt() { this.blip(160, 0.15, "sawtooth", 0.08); }
  powerup() { this.blip(800, 0.05); setTimeout(() => this.blip(1000, 0.05), 40); setTimeout(() => this.blip(1200, 0.08), 80); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.blip(f, 0.12, "sine", 0.08), i * 80)); }
  lose() { [400, 300, 200, 150].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, "sawtooth", 0.08), i * 120)); }
  shield() { this.blip(800, 0.1, "triangle", 0.08); this.blip(600, 0.15, "triangle", 0.06); }
  creature() { this.blip(1200, 0.06, "sine", 0.07); setTimeout(() => this.blip(1600, 0.1, "sine", 0.07), 50); }
}

// ============================================================
// GAME ENGINE
// ============================================================

class PongGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private paused = false;

  private player: Paddle;
  private ai: Paddle;
  private balls: Ball[] = [];
  private powerUps: PowerUp[] = [];
  private creatures: Creature[] = [];
  private particles: Particle[] = [];
  private effects: ActiveEffect[] = [];

  private cfg: MatchConfig;
  private cb: GameCallbacks;
  private sound: SoundEngine;

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
  private playerSwing = 0;
  private aiSwing = 0;

  private shake = 0;
  private flashAlpha = 0;
  private flashColor = "#fff";

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundBlur: () => void;
  private boundFocus: () => void;

  constructor(canvas: HTMLCanvasElement, cfg: MatchConfig, cb: GameCallbacks, sound: SoundEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cfg = cfg;
    this.cb = cb;
    this.sound = sound;

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

    this.boundKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.key);
      if (["ArrowUp", "ArrowDown", "w", "W", "s", "S"].includes(e.key)) e.preventDefault();
    };
    this.boundKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key);
    this.boundMouseMove = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const scaleY = H / rect.height;
      this.mouseY = (e.clientY - rect.top) * scaleY;
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
      const scaleY = H / rect.height;
      this.mouseY = (e.touches[0].clientY - rect.top) * scaleY;
      this.useMouse = true;
    };
    this.boundBlur = () => { this.paused = true; };
    this.boundFocus = () => { this.paused = false; this.lastTime = performance.now(); };
  }

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

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
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

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 60);
    if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 4);

    if (this.matchOver || this.paused) return;

    this.updatePlayer(dt);
    this.updateAI(dt);

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
    this.updateParticles(dt);
    this.updateEffects(dt);
    this.updateAIEffect(dt);
    this.updateAbilities(dt);
    if (this.playerSwing > 0) this.playerSwing = Math.max(0, this.playerSwing - dt * 6);
    if (this.aiSwing > 0) this.aiSwing = Math.max(0, this.aiSwing - dt * 6);
    this.spawnPowerUps(dt);
    this.spawnCreatures(dt);
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
    if (this.timeBubbleTimer > 0) this.timeBubbleTimer = Math.max(0, this.timeBubbleTimer - dt);
    this.cb.onAbility(this.slowMeter, this.petCooldown / 4);
  }

  private activatePet() {
    if (this.matchOver || this.paused || this.petCooldown > 0) return;
    this.petCooldown = 4;
    const y = this.player.y + this.player.h / 2;
    if (this.cfg.pet === "turtle") {
      this.timeBubbleTimer = 2.2;
      this.flash("#34d399", 0.1);
      this.emit(this.player.x + this.player.w + 45, y, PETS.turtle.color, 34, 5);
      this.sound.powerup();
    } else if (this.cfg.pet === "bat") {
      this.balls.push({ x: this.player.x + 30, y, vx: this.ballSpeed * 1.25, vy: (Math.random() - 0.5) * this.ballSpeed, r: 7, trail: [] });
      this.emit(this.player.x + 30, y, PETS.bat.color, 18, 5);
      this.sound.creature();
    } else {
      for (const ball of this.balls) {
        ball.vx = Math.abs(ball.vx) * 1.45;
        ball.vy *= 1.1;
      }
      if (this.balls.length === 0) {
        this.balls.push({ x: this.player.x + 30, y, vx: this.ballSpeed * 1.6, vy: 0, r: 8, trail: [] });
        this.waitingForBall = false;
      }
      this.emit(this.player.x + 30, y, PETS.dragon.color, 24, 6);
      this.sound.powerup();
    }
    this.cb.onAbility(this.slowMeter, 1);
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

  private updateBalls(dt: number) {
    const globalSlowFactor = this.effects.some((e) => e.type === "slowmo") || this.isTimeSlowActive() ? 0.45 : 1;

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      const bubbleFactor = this.isInTimeBubble(ball) ? 0.28 : 1;
      const slowFactor = globalSlowFactor * bubbleFactor;

      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 12) ball.trail.shift();

      ball.x += ball.vx * dt * 60 * slowFactor;
      ball.y += ball.vy * dt * 60 * slowFactor;

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

      if (ball.x < -ball.r) { this.balls.splice(i, 1); this.onAIScore(); }
      else if (ball.x > W + ball.r) { this.balls.splice(i, 1); this.onPlayerScore(); }
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
    if (ball.x + ball.r < paddle.x) return;
    if (ball.x - ball.r > paddle.x + paddle.w) return;
    if (ball.y + ball.r < paddle.y) return;
    if (ball.y - ball.r > paddle.y + paddle.h) return;
    if (isPlayer && ball.vx >= 0) return;
    if (!isPlayer && ball.vx <= 0) return;

    const hitPos = (ball.y - (paddle.y + paddle.h / 2)) / (paddle.h / 2);
    const clamped = Math.max(-0.5, Math.min(0.5, hitPos));
    const baseAngle = clamped * Math.PI * 0.35;
    const curveBonus = isPlayer ? this.cfg.curveball * 0.1 : 0;
    const angle = baseAngle * (1 + curveBonus);
    const direction = isPlayer ? 1 : -1;

    const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    const newSpeed = Math.min(currentSpeed * 1.04, this.ballSpeed * 2.5);

    ball.vx = direction * newSpeed * Math.cos(angle);
    ball.vy = newSpeed * Math.sin(angle);

    const minVy = newSpeed * 0.12;
    if (Math.abs(ball.vy) < minVy) ball.vy = (ball.vy >= 0 ? 1 : -1) * minVy;

    if (isPlayer) ball.x = paddle.x + paddle.w + ball.r + 1;
    else ball.x = paddle.x - ball.r - 1;

    this.sound.paddle();
    if (isPlayer) this.playerSwing = 1; else this.aiSwing = 1;
    this.shake = Math.min(8, this.shake + 3);
    this.emit(ball.x, ball.y, isPlayer ? this.cfg.paddleColor : "#e04050", 8, 3);
  }

  private checkBallPowerUps(ball: Ball) {
    for (let j = this.powerUps.length - 1; j >= 0; j--) {
      const pu = this.powerUps[j];
      const py = pu.y + Math.sin(pu.bob) * 6;
      const dx = ball.x - pu.x;
      const dy = ball.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < ball.r + 16) {
        const forPlayer = ball.vx > 0;
        this.applyPowerUp(pu.type, forPlayer);
        this.sound.powerup();
        this.emit(pu.x, py, POWERUP_META[pu.type].color, 15, 4);
        this.powerUps.splice(j, 1);
      }
    }
  }

  private checkBallCreatures(ball: Ball) {
    for (let j = this.creatures.length - 1; j >= 0; j--) {
      const c = this.creatures[j];
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      if (Math.sqrt(dx * dx + dy * dy) < ball.r + 14) {
        this.applyCreatureEffect(c);
        this.sound.creature();
        this.emit(c.x, c.y, CREATURE_META[c.type].color, 20, 5);
        this.creatures.splice(j, 1);
      }
    }
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
              this.balls.push({ x: main.x, y: main.y, vx: Math.sign(main.vx) * s * Math.cos(a), vy: s * Math.sin(a), r: 8, trail: [] });
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
              this.balls.push({ x: main.x, y: main.y, vx: Math.sign(main.vx) * s * Math.cos(a), vy: s * Math.sin(a), r: 8, trail: [] });
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
            this.balls.push({ x: main.x, y: main.y, vx: s * Math.cos(a), vy: s * Math.sin(a), r: 8, trail: [] });
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

  private onPlayerScore() {
    if (this.aiHasShield) {
      this.aiHasShield = false;
      this.sound.shield();
      this.flash("#facc15", 0.15);
      return;
    }
    this.pointsScored++;
    this.totalCoins += Math.round(5 * this.cfg.coinMult);
    this.sound.score();
    this.flash("#22c55e", 0.12);
    this.shake = 6;
    this.cb.onScore(this.pointsScored, this.cfg.pointsNeeded);
    this.cb.onCoins(this.totalCoins);
    if (this.pointsScored >= this.cfg.pointsNeeded) this.winMatch();
  }

  private onAIScore() {
    if (this.hasShield) {
      this.hasShield = false;
      this.sound.shield();
      this.flash("#facc15", 0.2);
      this.shake = 5;
      this.cb.onShieldChange(false);
      return;
    }
    this.hp--;
    this.sound.hurt();
    this.flash("#e04050", 0.25);
    this.shake = 10;
    this.cb.onHurt(this.hp, this.maxHp);
    if (this.hp <= 0) this.loseMatch();
  }

  private winMatch() {
    this.matchOver = true;
    const bonus = 20 + this.cfg.round * 5;
    this.totalCoins += Math.round(bonus * this.cfg.coinMult);
    this.cb.onCoins(this.totalCoins);
    this.sound.win();
    setTimeout(() => this.cb.onMatchWin(), 600);
  }

  private loseMatch() {
    this.matchOver = true;
    this.sound.lose();
    setTimeout(() => this.cb.onGameOver(), 900);
  }

  private resetBall() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const a = (Math.random() - 0.5) * Math.PI * 0.5;
    this.balls = [{ x: W / 2, y: H / 2, vx: dir * this.ballSpeed * Math.cos(a), vy: this.ballSpeed * Math.sin(a), r: 8, trail: [] }];
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
      type, bob: Math.random() * Math.PI * 2, life: 8000,
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
      this.powerUps[i].life -= dt * 1000;
      if (this.powerUps[i].life <= 0) this.powerUps.splice(i, 1);
    }
  }

  private updateCreatures(dt: number) {
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.x += c.vx * dt; c.y += c.vy * dt; c.bob += dt * 3;
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
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 400 + Math.random() * 300, maxLife: 700, color, size: 2 + Math.random() * 2 });
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95;
      p.life -= dt * 1000;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  private flash(color: string, alpha: number) {
    this.flashColor = color; this.flashAlpha = alpha;
  }

  // ── Aim arrow ──
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

  private drawPixelSprite(ctx: CanvasRenderingContext2D, grid: string[], x: number, y: number, size: number, palette: Record<string, string>) {
    const h = grid.length;
    const w = grid[0]?.length ?? 0;
    const ox = x - (w * size) / 2;
    const oy = y - (h * size) / 2;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const key = grid[row][col];
        const color = palette[key];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(ox + col * size), Math.round(oy + row * size), size, size);
      }
    }
  }

  private drawCreatureSprite(ctx: CanvasRenderingContext2D, c: Creature, y: number, alpha: number) {
    const meta = CREATURE_META[c.type];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = meta.color;
    ctx.shadowBlur = 0;
    const bob = Math.sin(c.bob * 2) * 1.5;
    if (c.type === "ghost") {
      this.drawPixelSprite(ctx, [
        "...gg...",
        "..gggg..",
        ".gggggg.",
        ".ggwgwg.",
        ".gggggg.",
        "..gggg..",
        ".gg..gg.",
        "gg....gg",
      ], c.x, y + bob, 5, { g: meta.color, w: "#0a0a14" });
    } else if (c.type === "demon") {
      this.drawPixelSprite(ctx, [
        "r......r",
        "rr....rr",
        ".rrrrrr.",
        "rrwrrwrr",
        "rrrrrrrr",
        ".rrwwrr.",
        "..rrrr..",
        ".r....r.",
      ], c.x, y + bob, 5, { r: meta.color, w: "#0a0a14" });
    } else if (c.type === "fairy") {
      this.drawPixelSprite(ctx, [
        "f..gg..f",
        "ff.gggff",
        ".ffggff.",
        "..gggg..",
        ".gwwwwg.",
        "..g..g..",
        ".f....f.",
      ], c.x, y + bob, 5, { f: "#a7f3d0", g: meta.color, w: "#f8fafc" });
    } else {
      this.drawPixelSprite(ctx, [
        "...bb...",
        ".bbbbbb.",
        "bbbbbbbb",
        "bbwbbWbb",
        "bbbbbbbb",
        ".bbbbbb.",
        "..b..b..",
        ".b....b.",
      ], c.x, y + bob, 5, { b: meta.color, w: "#0a0a14", W: "#0a0a14" });
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(c.x - 34, y + 27, 68, 12);
    ctx.fillStyle = meta.color;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(meta.label, c.x, y + 36);
    ctx.restore();
  }

  private drawPetSprite(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const pet = PETS[this.cfg.pet];
    ctx.save();
    ctx.shadowColor = pet.color;
    ctx.shadowBlur = 0;
    if (this.cfg.pet === "turtle") {
      this.drawPixelSprite(ctx, [
        "..ssss..",
        ".ssssss.",
        "ssggggss",
        "sggwwggs",
        ".sgggs..",
        "..s..s..",
      ], x, y, 3, { s: "#166534", g: pet.color, w: "#0a0a14" });
    } else if (this.cfg.pet === "bat") {
      this.drawPixelSprite(ctx, [
        "b..bb..b",
        "bb.bbbb.",
        ".bbwwbb.",
        "..bbbb..",
        ".b....b.",
      ], x, y, 3, { b: pet.color, w: "#0a0a14" });
    } else {
      this.drawPixelSprite(ctx, [
        "..rrrr..",
        ".rroorr.",
        "rrwwwwrr",
        "rrrrrrrr",
        ".rr..rr.",
        "..r..r..",
      ], x, y, 3, { r: pet.color, o: "#f97316", w: "#0a0a14" });
    }
    if (this.petCooldown <= 0) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fef08a";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("!", x, y - 18);
    }
    ctx.restore();
  }

  private drawRpgBackdrop(ctx: CanvasRenderingContext2D) {
    // Floor: varied stone tiles
    for (let y = 18; y < H - 18; y += 36) {
      for (let x = 0; x < W; x += 36) {
        const v = ((x * 7 + y * 13) % 41) / 41;
        ctx.fillStyle = `rgba(${Math.round(22 + v * 10)},${Math.round(18 + v * 8)},${Math.round(28 + v * 10)},1)`;
        ctx.fillRect(x, y, 35, 35);
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, 34, 34);
      }
    }
    // Top wall
    for (let x = -12; x < W + 12; x += 28) {
      ctx.fillStyle = "#1a1a26";
      ctx.fillRect(x, 0, 26, 18);
      ctx.fillStyle = "rgba(80,65,40,0.07)";
      ctx.fillRect(x + 1, 1, 24, 16);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeRect(x + 0.5, 0.5, 25, 17);
    }
    // Bottom wall
    for (let x = -12; x < W + 12; x += 28) {
      ctx.fillStyle = "#1a1a26";
      ctx.fillRect(x + 14, H - 18, 26, 18);
      ctx.fillStyle = "rgba(80,65,40,0.07)";
      ctx.fillRect(x + 15, H - 17, 24, 16);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeRect(x + 14.5, H - 17.5, 25, 17);
    }
    this.drawBanner(ctx, 92, 24, this.cfg.paddleColor, "P1");
    this.drawBanner(ctx, W - 92, 24, "#e04050", "AI");
  }

  private drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, text: string) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x - 18, y, 36, 28);
    ctx.beginPath();
    ctx.moveTo(x - 18, y + 28); ctx.lineTo(x, y + 18); ctx.lineTo(x + 18, y + 28); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, x, y + 15);
  }

  private getWeaponShape(): "sword" | "axe" | "hammer" | "staff" {
    const map: Record<string, "sword" | "axe" | "hammer" | "staff"> = {
      classic: "sword", neon: "sword", gold: "sword",
      inferno: "axe", matrix: "hammer", royal: "staff",
    };
    return map[this.cfg.paddleId] ?? "sword";
  }

  private drawWeaponSprite(ctx: CanvasRenderingContext2D, paddle: Paddle, color: string, isPlayer: boolean) {
    const swing = isPlayer ? this.playerSwing : this.aiSwing;
    const maxAngle = isPlayer ? 1.2 : -1.2;
    const idleSway = swing <= 0 ? Math.sin(performance.now() / 500 + (isPlayer ? 0 : 1.5)) * 0.04 : 0;
    const angle = swing > 0 ? Math.sin(swing * Math.PI / 2) * maxAngle : idleSway;

    const pivotX = paddle.x + paddle.w / 2;
    const pivotY = paddle.y + paddle.h * 0.82;
    const bladeLen = paddle.h + 10;
    const bw = Math.max(5, paddle.w);
    const idle = -Math.PI / 2;
    const shape = isPlayer ? this.getWeaponShape() : "sword";

    // Slash arc trail
    if (swing > 0.15) {
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.globalAlpha = swing * 0.35;
      ctx.strokeStyle = shape === "staff" ? color : "#ffffff";
      ctx.lineWidth = 4;
      const r = bladeLen * 0.72;
      ctx.beginPath();
      if (isPlayer) ctx.arc(0, 0, r, idle, idle + angle);
      else ctx.arc(0, 0, r, idle + angle, idle);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle);

    // Common: handle
    ctx.fillStyle = "#5c3a1e";
    ctx.fillRect(-2, -1, 4, 14);
    ctx.fillStyle = "#c8a84e";
    ctx.fillRect(-3, 12, 6, 4);

    if (shape === "sword") {
      // Guard
      ctx.fillStyle = "#c8a84e";
      ctx.fillRect(-bw - 2, -4, (bw + 2) * 2, 5);
      ctx.fillStyle = "#8a6e2a";
      ctx.fillRect(-bw - 2, 0, (bw + 2) * 2, 1);
      // Blade
      ctx.fillStyle = color;
      ctx.fillRect(-bw / 2, -bladeLen, bw, bladeLen - 4);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(-bw / 2, -bladeLen, 2, bladeLen - 4);
      // Tip
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-bw / 2, -bladeLen + 4);
      ctx.lineTo(0, -bladeLen - 8);
      ctx.lineTo(bw / 2, -bladeLen + 4);
      ctx.closePath();
      ctx.fill();
      // Outline
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-bw / 2, -3); ctx.lineTo(-bw / 2, -bladeLen + 4);
      ctx.lineTo(0, -bladeLen - 8); ctx.lineTo(bw / 2, -bladeLen + 4);
      ctx.lineTo(bw / 2, -3); ctx.stroke();
    } else if (shape === "axe") {
      // Shaft
      ctx.fillStyle = "#5c3a1e";
      ctx.fillRect(-2, -bladeLen + 10, 4, bladeLen - 10);
      // Axe head (curved blade)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(-bw * 1.8, -bladeLen + 18, bw * 3, 16, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.beginPath();
      ctx.ellipse(-bw * 1.8, -bladeLen + 16, bw * 2.5, 12, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(-bw * 1.8, -bladeLen + 18, bw * 3, 16, -0.35, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === "hammer") {
      // Shaft
      ctx.fillStyle = "#5c3a1e";
      ctx.fillRect(-2, -bladeLen + 16, 4, bladeLen - 16);
      // Hammer head
      ctx.fillStyle = color;
      ctx.fillRect(-bw * 2, -bladeLen - 2, bw * 4, 22);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.fillRect(-bw * 2, -bladeLen - 2, bw * 4, 4);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(-bw * 2, -bladeLen + 16, bw * 4, 4);
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5;
      ctx.strokeRect(-bw * 2, -bladeLen - 2, bw * 4, 22);
      // Rivets
      ctx.fillStyle = "#8a6e2a";
      ctx.beginPath(); ctx.arc(-bw, -bladeLen + 9, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bw, -bladeLen + 9, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      // Staff: thin shaft with orb
      ctx.fillStyle = "#3a2a14";
      ctx.fillRect(-1.5, -bladeLen + 8, 3, bladeLen - 8);
      // Orb glow
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, -bladeLen, 16, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // Orb
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(0, -bladeLen, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(-2, -bladeLen - 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -bladeLen, 9, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.restore();
  }

  private drawPowerUpSprite(ctx: CanvasRenderingContext2D, pu: PowerUp, y: number, alpha: number) {
    const meta = POWERUP_META[pu.type];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = meta.color;
    ctx.shadowBlur = 0;
    ctx.fillStyle = meta.color;
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 2;

    if (pu.type === "grow") {
      ctx.fillRect(pu.x - 4, y - 15, 8, 30);
      ctx.fillRect(pu.x - 15, y - 4, 30, 8);
    } else if (pu.type === "multiball") {
      for (const [dx, dy] of [[-9, 5], [0, -8], [9, 5]]) {
        ctx.beginPath(); ctx.arc(pu.x + dx, y + dy, 7, 0, Math.PI * 2); ctx.fill();
      }
    } else if (pu.type === "slowmo") {
      ctx.beginPath(); ctx.arc(pu.x, y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pu.x, y); ctx.lineTo(pu.x, y - 10); ctx.lineTo(pu.x + 8, y); ctx.stroke();
    } else if (pu.type === "shield") {
      ctx.beginPath();
      ctx.moveTo(pu.x, y - 17); ctx.lineTo(pu.x + 14, y - 8); ctx.lineTo(pu.x + 9, y + 13);
      ctx.lineTo(pu.x, y + 18); ctx.lineTo(pu.x - 9, y + 13); ctx.lineTo(pu.x - 14, y - 8);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pu.x, y + 13);
      ctx.bezierCurveTo(pu.x - 24, y - 4, pu.x - 10, y - 20, pu.x, y - 8);
      ctx.bezierCurveTo(pu.x + 10, y - 20, pu.x + 24, y - 4, pu.x, y + 13);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Rendering ──
  private render() {
    const ctx = this.ctx;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;

    ctx.fillStyle = this.cfg.courtBg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(sx, sy);
    this.drawRpgBackdrop(ctx);

    // Grid
    ctx.strokeStyle = this.cfg.courtGrid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Center line
    ctx.strokeStyle = this.cfg.courtLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 12]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Creatures
    for (const c of this.creatures) {
      const meta = CREATURE_META[c.type];
      const py = c.y + Math.sin(c.bob) * 4;
      const alpha = c.life < 2000 ? (c.life / 2000) * 0.7 + 0.3 : 1;
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = meta.color;
      ctx.beginPath(); ctx.arc(c.x, py, 20, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      this.drawCreatureSprite(ctx, c, py, alpha);
    }
    ctx.globalAlpha = 1;

    // Power-ups
    for (const pu of this.powerUps) {
      const py = pu.y + Math.sin(pu.bob) * 6;
      const meta = POWERUP_META[pu.type];
      const alpha = pu.life < 2000 ? (pu.life / 2000) * 0.7 + 0.3 : 1;
      ctx.globalAlpha = alpha * 0.12;
      ctx.fillStyle = meta.color;
      ctx.beginPath(); ctx.arc(pu.x, py, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      this.drawPowerUpSprite(ctx, pu, py, alpha);
    }
    ctx.globalAlpha = 1;

    // Particles
    for (const p of this.particles) {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ball trails
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

    // Player weapon
    this.drawWeaponSprite(ctx, this.player, this.cfg.paddleColor, true);

    // Pet familiar
    this.drawPetSprite(ctx, this.player.x - 26, this.player.y + this.player.h / 2 + Math.sin(performance.now() / 220) * 5);

    // AI weapon
    this.drawWeaponSprite(ctx, this.ai, "#e04050", false);

    // Turtle local time bubble
    if (this.timeBubbleTimer > 0) {
      const pct = this.timeBubbleTimer / 2.2;
      const cx = this.player.x + this.player.w + 58;
      const cy = this.player.y + this.player.h / 2;
      const pulse = Math.sin(performance.now() / 80) * 5;
      ctx.save();
      ctx.globalAlpha = 0.14 + pct * 0.18;
      ctx.fillStyle = PETS.turtle.color;
      ctx.beginPath(); ctx.arc(cx, cy, 90 + pulse, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = PETS.turtle.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath(); ctx.arc(cx, cy, 90 + pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = PETS.turtle.color;
      ctx.fillText("TIME BUBBLE", cx, cy - 102);
      ctx.restore();
    }

    // Balls — layered RPG orb
    for (const ball of this.balls) {
      if (this.isInTimeBubble(ball)) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PETS.turtle.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r + 8, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // Aura
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = this.cfg.ballColor;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r + 7, 0, Math.PI * 2); ctx.fill();
      // Body
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.cfg.ballColor;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill();
      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.arc(ball.x - 2.5, ball.y - 2.5, ball.r * 0.38, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Player shield
    if (this.hasShield) {
      ctx.strokeStyle = "rgba(250,204,21,0.6)"; ctx.lineWidth = 3; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.rect(this.player.x - 4, this.player.y - 4, this.player.w + 8, this.player.h + 8); ctx.stroke();
      ctx.setLineDash([]);
    }
    // AI shield
    if (this.aiHasShield) {
      ctx.strokeStyle = "rgba(250,204,21,0.4)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.rect(this.ai.x - 4, this.ai.y - 4, this.ai.w + 8, this.ai.h + 8); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Active effect bars
    let eY = this.player.y - 8;
    for (const e of this.effects) {
      const meta = POWERUP_META[e.type];
      ctx.fillStyle = meta.color; ctx.globalAlpha = 0.8;
      ctx.fillRect(this.player.x, eY, this.player.w * (e.timeLeft / e.duration), 3);
      eY -= 6;
    }
    ctx.globalAlpha = 1;

    // Aim arrow
    const aim = this.getAimPreview();
    if (aim !== null) {
      const cx = this.player.x + this.player.w + 6;
      const cy = aim.y;
      const len = 36;
      const ex = cx + Math.cos(aim.angle) * len;
      const ey = cy + Math.sin(aim.angle) * len;
      ctx.strokeStyle = this.cfg.paddleColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.shadowColor = this.cfg.paddleGlow; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(aim.angle - 0.4) * 8, ey - Math.sin(aim.angle - 0.4) * 8);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(aim.angle + 0.4) * 8, ey - Math.sin(aim.angle + 0.4) * 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Get ready
    if (this.waitingForBall && !this.matchOver) {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "16px monospace"; ctx.textAlign = "center";
      ctx.fillText("GET READY...", W / 2, H / 2 + 30);
    }

    // Paused
    if (this.paused && !this.matchOver) {
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#22d3ee";
      ctx.font = "bold 32px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("-- PAUSED --", W / 2, H / 2);
      ctx.font = "14px monospace"; ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("CLICK BACK TO RESUME", W / 2, H / 2 + 35);
    }

    ctx.restore();

    // Flash
    if (this.flashAlpha > 0) {
      ctx.fillStyle = this.flashColor; ctx.globalAlpha = this.flashAlpha;
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
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

// ============================================================
// RETRO STYLES
// ============================================================

const retroStyle = `
  .kp-overlay {
    font-family: 'Courier New', 'Lucida Console', monospace;
    image-rendering: pixelated;
  }
  @keyframes kp-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.2; } }
  @keyframes kp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  .kp-blink { animation: kp-blink 1s steps(1) infinite; }
  .kp-float { animation: kp-float 1.8s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .kp-blink, .kp-float { animation: none; }
    .kp-overlay * { transition: none !important; }
  }
  .kp-shadow { text-shadow: 2px 2px 0 #000, -1px -1px 0 #000; }
  .kp-card { background: #1a1530; border: 4px solid #c8a84e; box-shadow: inset 0 0 0 2px #0d0a18, 0 6px 0 rgba(0,0,0,.5); }
  .kp-btn { background: #1a1530; box-shadow: inset 0 -3px 0 rgba(0,0,0,.35); }
  .kp-btn:active:not(:disabled) { transform: translateY(2px); box-shadow: inset 0 -1px 0 rgba(0,0,0,.35); }
  .kp-overlay button:focus-visible { outline: 2px solid #fde047; outline-offset: 2px; }
`;

// ============================================================
// REACT COMPONENT
// ============================================================

export function KonamiPong() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [save, setSave] = useState<SaveData>(() => (typeof window === "undefined" ? defaultSave() : loadSave()));
  const [hud, setHud] = useState({ round: 1, points: 0, needed: 3, hp: 3, maxHp: 3, coins: 0, hasShield: false, slowMeter: 1, petCooldown: 0 });
  const [runPerks, setRunPerks] = useState<Record<string, number>>({});
  const [draftChoices, setDraftChoices] = useState<PerkDef[]>([]);
  const [runRound, setRunRound] = useState(1);
  const [runCoinsDisplay, setRunCoins] = useState(0);
  const [resultRound, setResultRound] = useState(1);
  const [resultCoins, setResultCoins] = useState(0);
  const [shopTab, setShopTab] = useState<"weapons" | "balls" | "courts" | "pets" | "upgrades">("weapons");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PongGame | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const runCoinsRef = useRef(0);
  const runPerksRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!soundRef.current) {
      soundRef.current = new SoundEngine();
      soundRef.current.muted = save.muted;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    persistSave(save);
    if (soundRef.current) soundRef.current.muted = save.muted;
  }, [save]);

  // Konami code
  useEffect(() => {
    if (phase !== "hidden") return;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[idx] || key.toLowerCase() === KONAMI[idx]) {
        idx++;
        clearTimeout(timer);
        timer = setTimeout(() => { idx = 0; }, 2000);
        if (idx === KONAMI.length) { idx = 0; soundRef.current?.ensure(); setPhase("menu"); }
      } else {
        idx = key === KONAMI[0] || key.toLowerCase() === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); clearTimeout(timer); };
  }, [phase]);

  // Escape
  useEffect(() => {
    if (phase === "hidden") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { gameRef.current?.stop(); setPhase("hidden"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase]);

  const computeConfig = useCallback((round: number, perks: Record<string, number>, sd: SaveData): MatchConfig => {
    const p = perks;
    const paddle = PADDLE_SKINS[sd.equippedPaddle] ?? PADDLE_SKINS.classic;
    const ball = BALL_SKINS[sd.equippedBall] ?? BALL_SKINS.classic;
    const court = COURT_SKINS[sd.equippedCourt] ?? COURT_SKINS.midnight;
    const coinUp = 1 + 0.1 * (sd.upgrades.coinBoost ?? 0);
    return {
      round, pointsNeeded: 3 + Math.floor(round / 2),
      baseHp: 3 + (sd.upgrades.startHp ?? 0) + (p.tanky ?? 0),
      paddleHeightMult: 1 + 0.2 * (p.bigRacket ?? 0),
      ballSpeedMult: 1 - 0.08 * (p.slowBall ?? 0),
      powerupRateMult: (1 + 0.4 * (p.powerUp ?? 0)) * (1 + 0.15 * (sd.upgrades.powerupFreq ?? 0)),
      coinMult: (1 + 0.3 * (p.greedy ?? 0)) * coinUp,
      startWithShield: (p.secondWind ?? 0) > 0,
      curveball: p.curveball ?? 0,
      startingCoins: runCoinsRef.current,
      pet: PETS[sd.equippedPet] ? sd.equippedPet : "turtle",
      paddleColor: paddle.color, paddleGlow: paddle.glow,
      paddleId: sd.equippedPaddle,
      ballColor: ball.color, ballTrail: ball.trail, ballGlow: ball.glow,
      courtBg: court.bg, courtGrid: court.grid, courtLine: court.line,
    };
  }, []);

  // Match lifecycle
  useEffect(() => {
    if (phase !== "playing") return;
    if (!canvasRef.current || !soundRef.current) return;

    const cfg = computeConfig(runRound, runPerksRef.current, save);

    const cb: GameCallbacks = {
      onScore: (points, needed) => setHud((h) => ({ ...h, points, needed })),
      onHurt: (hp) => setHud((h) => ({ ...h, hp })),
      onHeal: (hp) => setHud((h) => ({ ...h, hp })),
      onShieldChange: (hasShield) => setHud((h) => ({ ...h, hasShield })),
      onCoins: (coins) => { runCoinsRef.current = coins; setRunCoins(coins); setHud((h) => ({ ...h, coins })); },
      onAbility: (slowMeter, petCooldown) => setHud((h) => ({ ...h, slowMeter, petCooldown })),
      onMatchWin: () => {
        const available = PERKS.filter((perk) => (runPerksRef.current[perk.id] ?? 0) < perk.maxStacks);
        setDraftChoices([...available].sort(() => Math.random() - 0.5).slice(0, 3));
        setPhase("draft");
      },
      onGameOver: () => {
        const earned = runCoinsRef.current;
        setResultCoins(earned);
        setResultRound(runRound);
        setSave((s) => ({
          ...s, coins: s.coins + earned,
          bestRound: Math.max(s.bestRound, runRound),
          totalRuns: s.totalRuns + 1,
          totalCoins: s.totalCoins + earned,
        }));
        setPhase("gameover");
      },
    };

    gameRef.current = new PongGame(canvasRef.current, cfg, cb, soundRef.current);
    gameRef.current.start();
    return () => gameRef.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runRound]);

  const startRun = useCallback(() => {
    runCoinsRef.current = 0;
    runPerksRef.current = {};
    setRunCoins(0);
    setRunPerks({});
    setRunRound(1);
    const cfg = computeConfig(1, {}, save);
    setHud({ round: 1, points: 0, needed: cfg.pointsNeeded, hp: cfg.baseHp, maxHp: cfg.baseHp, coins: 0, hasShield: cfg.startWithShield, slowMeter: 1, petCooldown: 0 });
    setPhase("playing");
  }, [computeConfig, save]);

  const pickPerk = useCallback((perk: PerkDef) => {
    const newPerks = { ...runPerksRef.current, [perk.id]: (runPerksRef.current[perk.id] ?? 0) + 1 };
    runPerksRef.current = newPerks;
    setRunPerks(newPerks);
    const newRound = runRound + 1;
    setRunRound(newRound);
    const cfg = computeConfig(newRound, newPerks, save);
    setHud({ round: newRound, points: 0, needed: cfg.pointsNeeded, hp: cfg.baseHp, maxHp: cfg.baseHp, coins: runCoinsRef.current, hasShield: cfg.startWithShield, slowMeter: 1, petCooldown: 0 });
    setPhase("playing");
  }, [computeConfig, runRound, save]);

  const buyItem = useCallback((id: string, price: number) => {
    setSave((s) => {
      if (s.coins < price) return s;
      const next = { ...s, coins: s.coins - price };
      if (id in PADDLE_SKINS && !next.ownedPaddles.includes(id)) next.ownedPaddles.push(id);
      if (id in BALL_SKINS && !next.ownedBalls.includes(id)) next.ownedBalls.push(id);
      if (id in COURT_SKINS && !next.ownedCourts.includes(id)) next.ownedCourts.push(id);
      if (id in PETS && !next.ownedPets.includes(id)) next.ownedPets.push(id);
      return next;
    });
  }, []);

  const equipItem = useCallback((id: string) => {
    setSave((s) => {
      if (id in PADDLE_SKINS && s.ownedPaddles.includes(id)) return { ...s, equippedPaddle: id };
      if (id in BALL_SKINS && s.ownedBalls.includes(id)) return { ...s, equippedBall: id };
      if (id in COURT_SKINS && s.ownedCourts.includes(id)) return { ...s, equippedCourt: id };
      if (id in PETS && s.ownedPets.includes(id)) return { ...s, equippedPet: id as PetType };
      return s;
    });
  }, []);

  const buyUpgrade = useCallback((upgrade: UpgradeDef) => {
    setSave((s) => {
      const level = s.upgrades[upgrade.id] ?? 0;
      if (level >= upgrade.maxLevel) return s;
      const price = Math.round(upgrade.basePrice * Math.pow(upgrade.priceMult, level));
      if (s.coins < price) return s;
      return { ...s, coins: s.coins - price, upgrades: { ...s.upgrades, [upgrade.id]: level + 1 } };
    });
  }, []);

  const toggleMute = useCallback(() => setSave((s) => ({ ...s, muted: !s.muted })), []);
  const close = useCallback(() => { gameRef.current?.stop(); setPhase("hidden"); }, []);
  const equippedPet = PETS[save.equippedPet] ? save.equippedPet : "turtle";

  if (phase === "hidden") return null;

  return (
    <>
      <style>{retroStyle}</style>
      <div role="dialog" aria-modal="true" aria-label="Pong Quest" className="kp-overlay fixed inset-0 z-[9999] bg-black flex items-center justify-center select-none overflow-hidden">
        {/* Close + mute */}
        <button onClick={close} className="absolute top-3 right-4 z-10 p-1 text-white/60 hover:text-white text-lg transition-colors" aria-label="Close game">[X]</button>
        <button onClick={toggleMute} className="absolute top-3 right-14 z-10 p-1 text-white/60 hover:text-white text-sm transition-colors font-mono" aria-label={save.muted ? "Unmute sound" : "Mute sound"} aria-pressed={save.muted}>
          {save.muted ? "[MUTE]" : "[SND]"}
        </button>

        {/* ─── MENU ─── */}
        {phase === "menu" && (
          <div className="kp-card text-center text-white px-8 py-7 max-w-2xl">
            <div className="kp-float text-4xl mb-2 text-yellow-200 kp-shadow">/\</div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-[0.15em] text-yellow-200 kp-shadow mb-1">
              PONG QUEST
            </h1>
            <h2 className="text-xl sm:text-2xl font-bold tracking-[0.28em] text-purple-300 kp-shadow mb-2">
              PADDLE DUNGEON
            </h2>
            <div className="flex flex-wrap gap-x-5 gap-y-1 justify-center text-white/50 text-xs tracking-widest mb-8">
              <span>DEFLECT THE CURSED ORB</span>
              <span>FEED YOUR FAMILIAR</span>
              <span>ROB THE MONSTERS</span>
            </div>

            <div className="flex gap-8 justify-center mb-10 text-sm font-mono">
              <div className="text-center">
                <div className="text-white/50 text-xs tracking-widest">BEST</div>
                <div className="text-2xl font-bold text-yellow-200">R{String(save.bestRound).padStart(2, "0")}</div>
              </div>
              <div className="text-center">
                <div className="text-white/50 text-xs tracking-widest">RUNS</div>
                <div className="text-2xl font-bold text-purple-300">{String(save.totalRuns).padStart(3, "0")}</div>
              </div>
              <div className="text-center">
                <div className="text-white/50 text-xs tracking-widest">GOLD</div>
                <div className="text-2xl font-bold text-yellow-200">{String(save.coins).padStart(4, "0")}</div>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <button onClick={startRun} className="kp-btn px-8 py-3 border-2 border-yellow-300 text-yellow-200 font-bold tracking-widest text-sm hover:bg-yellow-300/10 transition-colors kp-shadow">
                ▶ START RUN
              </button>
              <button onClick={() => setPhase("shop")} className="kp-btn px-6 py-3 border border-white/25 text-white/70 font-semibold tracking-widest text-sm hover:border-white/50 hover:text-white transition-colors">
                TAVERN
              </button>
            </div>

            <div className="mt-12 flex flex-wrap gap-x-6 gap-y-1 justify-center text-xs text-white/45 tracking-widest font-mono">
              <span>MOUSE / ARROWS / WASD</span>
              <span>L-CLICK PET</span>
              <span>HOLD R-CLICK SLOW</span>
              <span>ESC TO QUIT</span>
            </div>
          </div>
        )}

        {/* ─── PLAYING ─── */}
        {phase === "playing" && (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            {/* HUD */}
            <div className="w-full max-w-[800px] flex items-center justify-between mb-2 px-1 font-mono">
              <div className="flex items-center gap-4">
                <span className="text-purple-300 text-sm tracking-widest kp-shadow">R{String(hud.round).padStart(2, "0")}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: hud.maxHp }).map((_, i) => (
                    <div key={i} className={`w-3 h-3 border ${i < hud.hp ? "bg-green-400 border-green-400" : "bg-transparent border-green-400/20"}`}
                      style={i < hud.hp ? { boxShadow: "0 0 4px rgba(34,197,94,0.6)" } : {}} />
                  ))}
                </div>
                {hud.hasShield && <span className="text-yellow-200 text-xs tracking-widest kp-shadow">[SHIELD]</span>}
              </div>
              <div className="text-yellow-200 text-2xl font-bold tracking-widest kp-shadow">
                {String(hud.points).padStart(2, "0")}<span className="text-yellow-200/40 mx-1">/</span>{String(hud.needed).padStart(2, "0")}
              </div>
              <div className="text-yellow-200 text-sm tracking-widest">★ {String(hud.coins).padStart(4, "0")}</div>
            </div>

            <div className="w-full max-w-[800px] flex items-center justify-between mb-2 px-1 font-mono text-[10px] tracking-widest">
              <div className="flex items-center gap-2">
                <span className="text-yellow-200">R-CLICK SLOW</span>
                <Meter value={hud.slowMeter} color="bg-yellow-300" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-purple-300">{PETS[equippedPet].name}</span>
                <span className="text-white/45">L-CLICK</span>
                <Meter value={1 - hud.petCooldown} color="bg-purple-300" />
              </div>
            </div>

            {/* Canvas */}
            <div className="relative overflow-hidden border-2 border-white/10" style={{ width: "min(95vw, 800px)", aspectRatio: "8 / 5" }}>
              <canvas ref={canvasRef} width={W} height={H} className="w-full h-full block cursor-none" />
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-1 justify-center text-white/45 text-xs mt-3 tracking-widest font-mono">
              <span>SCORE {hud.needed} TO ADVANCE</span>
              <span>POWER-UPS IN CENTER</span>
              <span>L-CLICK PET</span>
              <span>HOLD R-CLICK FOR BULLET TIME</span>
            </div>
          </div>
        )}

        {/* ─── DRAFT ─── */}
        {phase === "draft" && (
          <div className="kp-card text-center text-white px-6 py-6 max-w-3xl w-full font-mono">
            <h2 className="text-2xl font-black tracking-widest text-yellow-200 kp-shadow mb-1">ROOM CLEARED</h2>
            <p className="text-white/50 text-xs tracking-widest mb-8">CHOOSE ONE RELIC</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              {draftChoices.map((perk) => {
                const stacks = runPerks[perk.id] ?? 0;
                return (
                  <button key={perk.id} onClick={() => pickPerk(perk)}
                    className="group kp-btn relative p-5 border-2 border-white/10 hover:border-yellow-300/60 transition-[border-color,background-color] duration-150 text-center bg-black/40">
                    <div className="text-2xl mb-3 text-yellow-200 font-bold kp-float">{perk.icon}</div>
                    <div className="font-bold text-white text-sm tracking-widest mb-1">{perk.name}</div>
                    <div className="text-xs text-white/55">{perk.desc}</div>
                    {stacks > 0 && <div className="text-xs text-yellow-200/70 mt-2">LV {stacks}/{perk.maxStacks}</div>}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 text-sm text-yellow-200/70 tracking-widest">★ {runCoinsDisplay} EARNED</div>
          </div>
        )}

        {/* ─── GAME OVER ─── */}
        {phase === "gameover" && (
          <div className="kp-card text-center text-white px-8 py-7 font-mono">
            <h2 className="text-4xl font-black tracking-widest text-red-500 kp-shadow mb-2 kp-blink">GAME OVER</h2>
            <p className="text-white/50 text-sm tracking-widest mb-8">REACHED ROUND {resultRound}</p>
            <div className="flex gap-8 justify-center mb-10">
              <div className="text-center">
                <div className="text-white/50 text-xs tracking-widest">ROUND</div>
                <div className="text-3xl font-bold text-yellow-200 kp-shadow">{String(resultRound).padStart(2, "0")}</div>
              </div>
              <div className="text-center">
                <div className="text-white/50 text-xs tracking-widest">GOLD</div>
                <div className="text-3xl font-bold text-yellow-200 kp-shadow">{String(resultCoins).padStart(4, "0")}</div>
              </div>
              {resultRound >= save.bestRound && resultRound > 0 && (
                <div className="text-center">
                  <div className="text-white/30 text-xs tracking-widest">&nbsp;</div>
                  <div className="text-lg font-bold text-purple-300 kp-shadow mt-2 kp-blink">NEW BEST!</div>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={startRun} className="kp-btn px-8 py-3 border-2 border-yellow-300 text-yellow-200 font-bold tracking-widest text-sm hover:bg-yellow-300/10 transition-colors kp-shadow">
                ▶ START RUN
              </button>
              <button onClick={() => setPhase("shop")} className="kp-btn px-6 py-3 border border-white/25 text-white/70 font-semibold tracking-widest text-sm hover:border-white/50 hover:text-white transition-colors">
                TAVERN
              </button>
              <button onClick={() => setPhase("menu")} className="kp-btn px-6 py-3 border border-white/25 text-white/70 font-semibold tracking-widest text-sm hover:border-white/50 hover:text-white transition-colors">
                MENU
              </button>
            </div>
          </div>
        )}

        {/* ─── SHOP ─── */}
        {phase === "shop" && (
          <div className="kp-card w-full max-w-2xl px-6 py-6 text-white font-mono">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black tracking-widest text-purple-300 kp-shadow">FAMILIAR TAVERN</h2>
              <div className="text-yellow-200 font-bold tracking-widest">★ {String(save.coins).padStart(5, "0")}</div>
            </div>
            <div className="flex gap-1 mb-4 border-b border-white/10">
              {(["weapons", "balls", "courts", "pets", "upgrades"] as const).map((tab) => (
                <button key={tab} onClick={() => setShopTab(tab)} aria-pressed={shopTab === tab}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${shopTab === tab ? "text-yellow-200 border-b-2 border-yellow-300" : "text-white/50 hover:text-white/80"}`}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-2">
              {shopTab === "weapons" && Object.entries(PADDLE_SKINS).map(([id, skin]) => (
                <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedPaddles.includes(id)}
                  equipped={save.equippedPaddle === id} canAfford={save.coins >= skin.price}
                  onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                  preview={<div className="w-8 h-3" style={{ background: skin.color, boxShadow: `0 0 10px ${skin.glow}` }} />} />
              ))}
              {shopTab === "balls" && Object.entries(BALL_SKINS).map(([id, skin]) => (
                <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedBalls.includes(id)}
                  equipped={save.equippedBall === id} canAfford={save.coins >= skin.price}
                  onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                  preview={<div className="w-4 h-4 rounded-full" style={{ background: skin.color, boxShadow: `0 0 10px ${skin.glow}` }} />} />
              ))}
              {shopTab === "courts" && Object.entries(COURT_SKINS).map(([id, skin]) => (
                <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedCourts.includes(id)}
                  equipped={save.equippedCourt === id} canAfford={save.coins >= skin.price}
                  onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                  preview={<div className="w-10 h-6 border border-white/20" style={{ background: skin.bg }}><div className="w-full h-full flex items-center justify-center"><div className="w-px h-full" style={{ background: skin.line }} /></div></div>} />
              ))}
              {shopTab === "pets" && Object.entries(PETS).map(([id, pet]) => (
                <ShopRow key={id} name={pet.name} price={pet.price} owned={save.ownedPets.includes(id)}
                  equipped={save.equippedPet === id} canAfford={save.coins >= pet.price}
                  onBuy={() => buyItem(id, pet.price)} onEquip={() => equipItem(id)}
                  desc={pet.desc}
                  preview={<PixelPetPreview pet={id as PetType} color={pet.color} />} />
              ))}
              {shopTab === "upgrades" && UPGRADES.map((upg) => {
                const level = save.upgrades[upg.id] ?? 0;
                const price = Math.round(upg.basePrice * Math.pow(upg.priceMult, level));
                const maxed = level >= upg.maxLevel;
                return (
                  <div key={upg.id} className="flex items-center gap-4 p-2.5 border border-white/10 bg-black/30">
                    <div className="flex-1">
                      <div className="font-bold text-sm flex items-center gap-2 tracking-widest">
                        {upg.name}
                        <span className="text-xs text-white/50" aria-label={`Level ${level} of ${upg.maxLevel}`}>{"*".repeat(level)}{".".repeat(upg.maxLevel - level)}</span>
                      </div>
                      <div className="text-xs text-white/55">{upg.desc}</div>
                    </div>
                    <button onClick={() => buyUpgrade(upgradeRef(upg))} disabled={maxed || save.coins < price}
                      className={`kp-btn px-4 py-2 text-xs font-bold tracking-widest transition-colors ${maxed ? "text-white/45 border border-white/10" : save.coins >= price ? "text-yellow-200 hover:bg-yellow-300/10 border border-yellow-300/50" : "text-white/45 border border-white/10"}`}>
                      {maxed ? "MAX" : `${price}G`}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 justify-center mt-6">
              <button onClick={startRun} className="kp-btn px-6 py-3 border-2 border-yellow-300 text-yellow-200 font-bold tracking-widest text-sm hover:bg-yellow-300/10 transition-colors kp-shadow">
                ▶ START RUN
              </button>
              <button onClick={() => setPhase("menu")} className="kp-btn px-6 py-3 border border-white/25 text-white/70 font-semibold tracking-widest text-sm hover:border-white/50 hover:text-white transition-colors">
                MENU
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ponytail: helper to pass UpgradeDef as ref — avoids inline closure recreation
function upgradeRef(u: UpgradeDef): UpgradeDef { return u; }

// ============================================================
// SHOP ROW
// ============================================================

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-24 border border-white/15 bg-black/60">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function PixelPetPreview({ pet, color }: { pet: PetType; color: string }) {
  const rows = pet === "turtle"
    ? [".xxxx.", "xoooox", "xo..ox", ".x..x."]
    : pet === "bat"
    ? ["x.xx.x", "xxoox.", ".xxxx.", "x....x"]
    : [".xxxx.", "xxooxx", "xxxxxx", ".x..x."];
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${rows[0].length}, 4px)` }}>
      {rows.flatMap((row, r) => row.split("").map((cell, c) => (
        <div key={`${r}-${c}`} className="h-1 w-1" style={{ background: cell === "." ? "transparent" : cell === "o" ? "#050505" : color }} />
      )))}
    </div>
  );
}

function ShopRow({ name, price, owned, equipped, canAfford, onBuy, onEquip, preview, desc }: {
  name: string; price: number; owned: boolean; equipped: boolean; canAfford: boolean;
  onBuy: () => void; onEquip: () => void; preview: React.ReactNode; desc?: string;
}) {
  return (
    <div className="flex items-center gap-4 p-2.5 border border-white/10 bg-black/30 font-mono">
      <div className="flex items-center justify-center w-12 h-8">{preview}</div>
      <div className="flex-1">
        <div className="font-bold text-sm tracking-widest">{name}</div>
        {desc ? <div className="text-[10px] text-white/55 tracking-widest mt-0.5">{desc}</div> : null}
      </div>
      {equipped ? (
        <span className="px-4 py-2 text-xs font-bold text-yellow-200 tracking-widest">[EQUIPPED]</span>
      ) : owned ? (
        <button onClick={onEquip} className="kp-btn px-4 py-2 text-xs font-bold border border-white/25 text-white/70 hover:border-white/50 hover:text-white hover:bg-white/5 transition-colors tracking-widest">EQUIP</button>
      ) : (
        <button onClick={onBuy} disabled={!canAfford}
          className={`kp-btn px-4 py-2 text-xs font-bold tracking-widest transition-colors ${canAfford ? "text-yellow-200 hover:bg-yellow-300/10 border border-yellow-300/50" : "text-white/45 border border-white/10"}`}>
          {price}G
        </button>
      )}
    </div>
  );
}
