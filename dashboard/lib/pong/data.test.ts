import { afterEach, describe, expect, it } from "vitest";
import {
  AI_BASE_HEIGHT,
  BALL_SKINS,
  COURT_SKINS,
  CREATURE_META,
  KONAMI,
  loadSave,
  PADDLE_SKINS,
  parseSave,
  PERKS,
  persistSave,
  PETS,
  POWERUP_META,
  SAVE_KEY,
  UPGRADES,
  W,
  H,
  defaultSave,
} from "./data";

/** A v1 save exactly as the pre-reskin game wrote it. */
const LEGACY_SAVE = JSON.stringify({
  coins: 340,
  ownedPaddles: ["classic", "neon"],
  ownedBalls: ["classic", "comet"],
  ownedCourts: ["midnight", "deep"],
  equippedPaddle: "neon",
  equippedBall: "comet",
  equippedCourt: "deep",
  ownedPets: ["turtle", "bat"],
  equippedPet: "bat",
  upgrades: { startHp: 1, coinBoost: 3 },
  bestRound: 7,
  totalRuns: 12,
  totalCoins: 2210,
  muted: true,
});

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    store,
  };
}

describe("pong save compatibility", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("keeps the storage key and the save field set", () => {
    expect(SAVE_KEY).toBe("konami-pong-v1");
    expect(Object.keys(defaultSave()).sort()).toEqual([
      "bestRound", "coins", "equippedBall", "equippedCourt", "equippedPaddle", "equippedPet",
      "muted", "ownedBalls", "ownedCourts", "ownedPaddles", "ownedPets", "totalCoins", "totalRuns", "upgrades",
    ]);
  });

  it("loads an old save untouched", () => {
    const s = parseSave(LEGACY_SAVE);
    expect(s).toEqual(JSON.parse(LEGACY_SAVE));
    expect(s.muted).toBe(true);
    expect(s.equippedPet).toBe("bat");
  });

  it("fills fields an older save lacks and survives junk", () => {
    expect(parseSave(JSON.stringify({ coins: 5 }))).toEqual({ ...defaultSave(), coins: 5 });
    expect(parseSave("not json")).toEqual(defaultSave());
    expect(parseSave("[1,2,3]")).toEqual(defaultSave());
    expect(parseSave(null)).toEqual(defaultSave());
  });

  it("round-trips through localStorage", () => {
    const storage = fakeStorage();
    (globalThis as { window?: unknown }).window = {};
    (globalThis as { localStorage?: unknown }).localStorage = storage;
    storage.setItem(SAVE_KEY, LEGACY_SAVE);
    const loaded = loadSave();
    persistSave({ ...loaded, coins: loaded.coins + 10, muted: false });
    expect(JSON.parse(storage.store.get(SAVE_KEY) as string)).toEqual({ ...JSON.parse(LEGACY_SAVE), coins: 350, muted: false });
  });

  it("keeps every id a save can reference", () => {
    expect(Object.keys(PADDLE_SKINS)).toEqual(["classic", "neon", "inferno", "matrix", "royal", "gold"]);
    expect(Object.keys(BALL_SKINS)).toEqual(["classic", "comet", "plasma", "ice", "void"]);
    expect(Object.keys(COURT_SKINS)).toEqual(["midnight", "synthwave", "terminal", "sunset", "deep"]);
    expect(Object.keys(PETS)).toEqual(["turtle", "bat", "dragon"]);
    expect(PERKS.map((p) => p.id)).toEqual(["bigRacket", "slowBall", "powerUp", "greedy", "secondWind", "tanky", "curveball"]);
    expect(UPGRADES.map((u) => u.id)).toEqual(["startHp", "coinBoost", "powerupFreq"]);
    expect(Object.keys(POWERUP_META)).toEqual(["grow", "multiball", "slowmo", "shield", "heart"]);
    expect(Object.keys(CREATURE_META)).toEqual(["ghost", "demon", "fairy", "blob"]);
  });

  it("keeps balance constants and the Konami sequence", () => {
    expect([W, H, AI_BASE_HEIGHT]).toEqual([800, 500, 80]);
    expect(KONAMI.join(",")).toBe("ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,b,a");
    expect(PERKS.map((p) => p.maxStacks)).toEqual([5, 5, 3, 3, 1, 3, 3]);
    expect(UPGRADES.map((u) => [u.basePrice, u.maxLevel, u.priceMult])).toEqual([[200, 2, 2], [100, 5, 1.5], [150, 3, 1.8]]);
  });

  it("never uses ASCII glyph icons for perks", () => {
    for (const p of PERKS) expect(p.icon).toMatch(/^[a-zA-Z]{4,}$/);
  });
});
