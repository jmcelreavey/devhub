// Pong Quest — static game data and the save format.
//
// Ids in here (skins, perks, upgrades, power-ups, creatures, pets) and the
// SaveData shape are the contract with saves already in players' browsers
// (localStorage key `konami-pong-v1`). Names, prices and effects are balance.
// Art is looked up by id, so a reskin never touches them.

export type Phase = "hidden" | "menu" | "playing" | "draft" | "gameover" | "shop";

export type PowerUpType = "grow" | "multiball" | "slowmo" | "shield" | "heart";
export type CreatureType = "ghost" | "demon" | "fairy" | "blob";
export type PetType = "turtle" | "bat" | "dragon";

export interface SaveData {
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

export const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
  "b", "a",
];

export const W = 800;
export const H = 500;
export const AI_BASE_HEIGHT = 80;

export const PADDLE_SKINS: Record<string, { name: string; price: number; color: string; glow: string }> = {
  classic: { name: "IRON SWORD", price: 0, color: "#d4cfa8", glow: "rgba(212,207,168,0.3)" },
  neon: { name: "MITHRIL BLADE", price: 150, color: "#6bb6ff", glow: "rgba(107,182,255,0.3)" },
  inferno: { name: "BATTLE AXE", price: 200, color: "#f97316", glow: "rgba(249,115,22,0.3)" },
  matrix: { name: "WAR HAMMER", price: 150, color: "#22c55e", glow: "rgba(34,197,94,0.3)" },
  royal: { name: "ARCANE STAFF", price: 200, color: "#a855f7", glow: "rgba(168,85,247,0.3)" },
  gold: { name: "GOLDEN SWORD", price: 500, color: "#fbbf24", glow: "rgba(251,191,36,0.4)" },
};

export const BALL_SKINS: Record<string, { name: string; price: number; color: string; trail: boolean; glow: string }> = {
  classic: { name: "CLASSIC", price: 0, color: "#f8fafc", trail: false, glow: "rgba(248,250,252,0.4)" },
  comet: { name: "COMET", price: 150, color: "#fbbf24", trail: true, glow: "rgba(251,191,36,0.7)" },
  plasma: { name: "PLASMA", price: 200, color: "#e879f9", trail: true, glow: "rgba(232,121,249,0.7)" },
  ice: { name: "ICE", price: 200, color: "#67e8f9", trail: true, glow: "rgba(103,232,249,0.7)" },
  void: { name: "VOID", price: 500, color: "#e04050", trail: true, glow: "rgba(224,64,80,0.8)" },
};

export const COURT_SKINS: Record<string, { name: string; price: number; bg: string; grid: string; line: string }> = {
  midnight: { name: "STONE KEEP", price: 0, bg: "#1a1520", grid: "rgba(70,55,30,0.12)", line: "rgba(100,80,50,0.2)" },
  synthwave: { name: "ENCHANTED", price: 200, bg: "#0d1a12", grid: "rgba(40,70,30,0.12)", line: "rgba(60,110,50,0.2)" },
  terminal: { name: "GLOOM CAVE", price: 150, bg: "#1a1408", grid: "rgba(60,50,20,0.15)", line: "rgba(100,80,30,0.2)" },
  sunset: { name: "LAVA PIT", price: 200, bg: "#1e0a0a", grid: "rgba(80,30,20,0.12)", line: "rgba(150,60,30,0.2)" },
  deep: { name: "ABYSS", price: 300, bg: "#0a0f1a", grid: "rgba(30,50,80,0.12)", line: "rgba(50,80,120,0.2)" },
};

export const PETS: Record<PetType, { name: string; price: number; color: string; desc: string }> = {
  turtle: { name: "TIME TURTLE", price: 0, color: "#34d399", desc: "LEFT CLICK: paddle time bubble" },
  bat: { name: "BATSY", price: 250, color: "#a78bfa", desc: "LEFT CLICK: spawn helper ball" },
  dragon: { name: "SPARK DRAGON", price: 400, color: "#e04050", desc: "LEFT CLICK: launch balls faster" },
};

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  /** Badge kind drawn by the UI (never a character glyph). */
  icon: string;
  maxStacks: number;
}

export const PERKS: PerkDef[] = [
  { id: "bigRacket", name: "BIG RACKET", desc: "+20% paddle size", icon: "bigRacket", maxStacks: 5 },
  { id: "slowBall", name: "HEAVY BALL", desc: "-8% ball speed", icon: "slowBall", maxStacks: 5 },
  { id: "powerUp", name: "LUCKY STRIKE", desc: "+40% power-up rate", icon: "powerUp", maxStacks: 3 },
  { id: "greedy", name: "GOLDEN TOUCH", desc: "+30% coins", icon: "greedy", maxStacks: 3 },
  { id: "secondWind", name: "SECOND WIND", desc: "Shield at start", icon: "secondWind", maxStacks: 1 },
  { id: "tanky", name: "TANK", desc: "+1 max HP", icon: "tanky", maxStacks: 3 },
  { id: "curveball", name: "CURVEBALL", desc: "Sharper angles", icon: "curveball", maxStacks: 3 },
];

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  basePrice: number;
  maxLevel: number;
  priceMult: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: "startHp", name: "VITALITY", desc: "+1 starting HP", basePrice: 200, maxLevel: 2, priceMult: 2 },
  { id: "coinBoost", name: "COIN MAGNET", desc: "+10% coins", basePrice: 100, maxLevel: 5, priceMult: 1.5 },
  { id: "powerupFreq", name: "FORTUNE", desc: "+15% power-up rate", basePrice: 150, maxLevel: 3, priceMult: 1.8 },
];

export const POWERUP_META: Record<PowerUpType, { color: string; label: string }> = {
  grow: { color: "#22c55e", label: "GROW" },
  multiball: { color: "#f97316", label: "MULTI" },
  slowmo: { color: "#3b82f6", label: "SLOW" },
  shield: { color: "#facc15", label: "SHIELD" },
  heart: { color: "#ec4899", label: "HP+" },
};

export const POWERUP_TYPES: PowerUpType[] = ["grow", "multiball", "slowmo", "shield", "heart"];
export const POWERUP_WEIGHTS: Record<PowerUpType, number> = {
  grow: 25, multiball: 20, slowmo: 20, shield: 20, heart: 8,
};

export const CREATURE_META: Record<CreatureType, { color: string; label: string }> = {
  ghost: { color: "#a78bfa", label: "COIN GHOST" },
  demon: { color: "#ef4444", label: "SPEED DEMON" },
  fairy: { color: "#34d399", label: "HEAL FAIRY" },
  blob: { color: "#f59e0b", label: "CHAOS BLOB" },
};

// ── save / load ──────────────────────────────────────────────────────────

export const SAVE_KEY = "konami-pong-v1";

export function defaultSave(): SaveData {
  return {
    coins: 0, ownedPaddles: ["classic"], ownedBalls: ["classic"], ownedCourts: ["midnight"],
    equippedPaddle: "classic", equippedBall: "classic", equippedCourt: "midnight",
    ownedPets: ["turtle"], equippedPet: "turtle",
    upgrades: {}, bestRound: 0, totalRuns: 0, totalCoins: 0, muted: false,
  };
}

/** Parses a stored save, filling any missing field from the defaults. */
export function parseSave(raw: string | null): SaveData {
  if (!raw) return defaultSave();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultSave();
    return { ...defaultSave(), ...(parsed as Partial<SaveData>) };
  } catch {
    return defaultSave();
  }
}

export function loadSave(): SaveData {
  if (typeof window === "undefined") return defaultSave();
  try {
    return parseSave(localStorage.getItem(SAVE_KEY));
  } catch {
    return defaultSave();
  }
}

export function persistSave(data: SaveData) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* noop */ }
}
