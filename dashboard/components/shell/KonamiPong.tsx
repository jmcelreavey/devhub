"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BALL_SKINS,
  COURT_SKINS,
  H,
  KONAMI,
  PADDLE_SKINS,
  PERKS,
  PETS,
  UPGRADES,
  W,
  defaultSave,
  loadSave,
  persistSave,
  type PerkDef,
  type PetType,
  type Phase,
  type SaveData,
  type UpgradeDef,
} from "@/lib/pong/data";
import { PongAudio } from "@/lib/pong/audio";
import { MANIFEST } from "@/lib/pong/manifest";
import { FOE_RAIL_W, PET_RAIL_W } from "@/lib/pong/placement";
import { getAssets } from "./pong/assets";
import { Badge, CloseIcon, Gold, HeartGem, HourglassIcon, PauseIcon, ShieldIcon, SpeakerIcon, SparkleIcon } from "./pong/badges";
import { FX_BLEED_X, FX_BLEED_Y, PongGame, type GameCallbacks, type MatchConfig } from "./pong/PongGame";
import { popStyle } from "./pong/styles";

/**
 * `autoStart` is set by `KonamiGate`, which has already matched the sequence
 * before dynamically importing this module — so we open on the menu rather
 * than waiting for a second run of the code. Without the gate (or on Escape
 * back to "hidden") the component's own listener below still works.
 *
 * Game rules, balance and the save format are unchanged from the original
 * roguelite; see `lib/pong/data.ts`. This file is the UI shell around
 * `pong/PongGame.ts`.
 */

// ── small presentational helpers ─────────────────────────────────────────

type ShopTab = "weapons" | "balls" | "courts" | "pets" | "upgrades";
const SHOP_TABS: ShopTab[] = ["weapons", "balls", "courts", "pets", "upgrades"];
const TAB_LABEL: Record<ShopTab, string> = { weapons: "Weapons", balls: "Orbs", courts: "Arenas", pets: "Familiars", upgrades: "Boons" };

/** A sprite as an <img>, 1x/2x from the manifest. */
function SpriteImg({ id, height, className, flip }: { id: string; height: number; className?: string; flip?: boolean }) {
  const s = MANIFEST.sprites[id];
  if (!s) return null;
  const w = Math.round((s.w * height) / s.h);
  const base = `/pong/${s.file}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- fixed-size game sprites with a 2x srcSet
    <img
      src={`${base}.webp`}
      srcSet={`${base}.webp 1x, ${base}@2x.webp 2x`}
      width={w}
      height={height}
      alt=""
      draggable={false}
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function Meter({ value, tone }: { value: number; tone?: "gold" | "violet" }) {
  return (
    <div className={`kp-bar${tone === "violet" ? " kp-bar-violet" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, value)) * 100)}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function Pips({ level, max, next }: { level: number; max: number; next?: boolean }) {
  return (
    <div className="kp-pips" role="img" aria-label={`Level ${level} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`kp-pip${i < level ? " on" : next && i === level ? " next" : ""}`} />
      ))}
    </div>
  );
}

// ── shopkeeper ───────────────────────────────────────────────────────────

type Mood = "smile" | "blink" | "excited" | "pout" | "wink";
const MOOD_FRAME: Record<Mood, string> = {
  smile: "shopkeeper-bust-0",
  blink: "shopkeeper-bust-1",
  excited: "shopkeeper-bust-2",
  pout: "shopkeeper-bust-3",
  wink: "shopkeeper-bust-4",
};
const LINES = {
  idle: [
    "Welcome to the Familiar Tavern! Take your time.",
    "Weapons, orbs, arenas, companions… I've got it all.",
    "Your familiar looks hungry for a rematch, hero.",
    "Every great run starts with the right blade.",
    "Gold doesn't spend itself, you know~",
  ],
  thanks: ["Thank you, hero! A pleasure doing business~", "Ooh, a fine choice! It suits you.", "Sold! Come back any time!"],
  broke: ["Hmm, a little short on gold… win a few more rounds!", "Not quite enough yet. Next run, maybe?", "Gold first, shopping second~"],
  equip: ["Looking sharp!", "Ooh, that's my favourite too.", "Go show them what you've got!"],
};
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** One restartable timeout, held in state so renders never touch a ref. */
class OneShot {
  private id: ReturnType<typeof setTimeout> | null = null;
  run(fn: () => void, ms: number) { this.clear(); this.id = setTimeout(fn, ms); }
  clear() { if (this.id !== null) clearTimeout(this.id); this.id = null; }
}

// ── component ────────────────────────────────────────────────────────────

export function KonamiPong({ autoStart = false }: { autoStart?: boolean } = {}) {
  const [phase, setPhase] = useState<Phase>(autoStart ? "menu" : "hidden");
  const [save, setSave] = useState<SaveData>(() => (typeof window === "undefined" ? defaultSave() : loadSave()));
  const [hud, setHud] = useState({ round: 1, points: 0, needed: 3, hp: 3, maxHp: 3, coins: 0, hasShield: false, slowMeter: 1, petCooldown: 0 });
  const [runPerks, setRunPerks] = useState<Record<string, number>>({});
  const [draftChoices, setDraftChoices] = useState<PerkDef[]>([]);
  const [runRound, setRunRound] = useState(1);
  const [runCoinsDisplay, setRunCoins] = useState(0);
  const [resultRound, setResultRound] = useState(1);
  const [resultCoins, setResultCoins] = useState(0);
  const [shopTab, setShopTab] = useState<ShopTab>("weapons");
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);

  const [mood, setMood] = useState<Mood>("smile");
  const [line, setLine] = useState(LINES.idle[0]);
  const [lineKey, setLineKey] = useState(0);
  const [bounceKey, setBounceKey] = useState(0);
  // held in state, not refs: stable across renders and safe to pass to child handlers
  const [audio] = useState(() => new PongAudio());
  const [moodTimer] = useState(() => new OneShot());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PongGame | null>(null);
  const runCoinsRef = useRef(0);
  const runPerksRef = useRef<Record<string, number>>({});
  // Latest handlers for the window key listener, which is bound per phase and must not go stale.
  const startRunRef = useRef<() => void>(() => {});
  const pickPerkRef = useRef<(perk: PerkDef) => void>(() => {});
  const draftChoicesRef = useRef<PerkDef[]>([]);

  useEffect(() => () => audio.dispose(), [audio]);

  useEffect(() => {
    persistSave(save);
    audio.setMuted(save.muted);
  }, [save, audio]);

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
        if (idx === KONAMI.length) { idx = 0; audio.ensure(); setPhase("menu"); }
      } else {
        idx = key === KONAMI[0] || key.toLowerCase() === KONAMI[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); clearTimeout(timer); };
  }, [phase, audio]);

  // Keys: Esc pauses a round (and leaves every other screen); P pauses; Enter starts; 1-3 draft; M mutes.
  useEffect(() => {
    if (phase === "hidden") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (key === "Escape") {
        if (phase === "playing") {
          const game = gameRef.current;
          if (!game) return;
          const next = !game.isManuallyPaused;
          game.setManualPause(next);
          setPaused(next);
        } else {
          gameRef.current?.stop();
          setPaused(false);
          setPhase("hidden");
        }
      } else if (key === "p" || key === "P") {
        const game = gameRef.current;
        if (phase !== "playing" || !game) return;
        const next = !game.isManuallyPaused;
        game.setManualPause(next);
        setPaused(next);
      } else if (key === "m" || key === "M") {
        setSave((s) => ({ ...s, muted: !s.muted }));
      } else if (key === "Enter" && (phase === "menu" || phase === "gameover")) {
        const el = document.activeElement as HTMLElement | null;
        if (el?.tagName === "BUTTON") return; // a focused button already handles Enter
        e.preventDefault();
        startRunRef.current();
      } else if ((key === "1" || key === "2" || key === "3") && phase === "draft") {
        const choice = draftChoicesRef.current[Number(key) - 1];
        if (choice) pickPerkRef.current(choice);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase]);

  // Art: start fetching as soon as the game is opened.
  useEffect(() => {
    if (phase !== "hidden") void getAssets(Math.min(1.6, (window.devicePixelRatio || 1) * 1.25)).load();
  }, [phase]);

  // Music follows the screen.
  useEffect(() => {
    audio.setMusic(phase === "hidden" ? null : phase === "playing" ? "arena" : "menu");
  }, [phase, audio]);

  const computeConfig = useCallback((round: number, perks: Record<string, number>, sd: SaveData): MatchConfig => {
    const p = perks;
    const paddleId = PADDLE_SKINS[sd.equippedPaddle] ? sd.equippedPaddle : "classic";
    const ballId = BALL_SKINS[sd.equippedBall] ? sd.equippedBall : "classic";
    const courtId = COURT_SKINS[sd.equippedCourt] ? sd.equippedCourt : "midnight";
    const paddle = PADDLE_SKINS[paddleId];
    const ball = BALL_SKINS[ballId];
    const court = COURT_SKINS[courtId];
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
      paddleId,
      ballId, ballColor: ball.color, ballTrail: ball.trail, ballGlow: ball.glow,
      courtId, courtBg: court.bg, courtGrid: court.grid, courtLine: court.line,
    };
  }, []);

  // Match lifecycle
  useEffect(() => {
    if (phase !== "playing") return;
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const sound = audio;
    let cancelled = false;
    let game: PongGame | null = null;

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

    // Court scale on screen decides which bitmaps are worth loading.
    const shown = canvas.getBoundingClientRect().width || 800;
    const assets = getAssets((shown / 800) * (window.devicePixelRatio || 1));
    setLoading(!assets.ready);
    void assets.load().then(() => {
      if (cancelled) return;
      setLoading(false);
      game = new PongGame(canvas, cfg, cb, sound, assets);
      gameRef.current = game;
      const hook = window as unknown as { __PONG_HARNESS__?: boolean; __pongGame?: PongGame };
      if (hook.__PONG_HARNESS__) hook.__pongGame = game;
      game.start();
    });
    return () => {
      cancelled = true;
      game?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, runRound]);

  const startRun = useCallback(() => {
    audio.click();
    runCoinsRef.current = 0;
    runPerksRef.current = {};
    setRunCoins(0);
    setRunPerks({});
    setRunRound(1);
    const cfg = computeConfig(1, {}, save);
    setHud({ round: 1, points: 0, needed: cfg.pointsNeeded, hp: cfg.baseHp, maxHp: cfg.baseHp, coins: 0, hasShield: cfg.startWithShield, slowMeter: 1, petCooldown: 0 });
    setPaused(false);
    setPhase("playing");
  }, [computeConfig, save, audio]);

  const pickPerk = useCallback((perk: PerkDef) => {
    audio.equip();
    const newPerks = { ...runPerksRef.current, [perk.id]: (runPerksRef.current[perk.id] ?? 0) + 1 };
    runPerksRef.current = newPerks;
    setRunPerks(newPerks);
    const newRound = runRound + 1;
    setRunRound(newRound);
    const cfg = computeConfig(newRound, newPerks, save);
    setHud({ round: newRound, points: 0, needed: cfg.pointsNeeded, hp: cfg.baseHp, maxHp: cfg.baseHp, coins: runCoinsRef.current, hasShield: cfg.startWithShield, slowMeter: 1, petCooldown: 0 });
    setPaused(false);
    setPhase("playing");
  }, [computeConfig, runRound, save, audio]);

  useEffect(() => {
    startRunRef.current = startRun;
    pickPerkRef.current = pickPerk;
    draftChoicesRef.current = draftChoices;
  });

  const resumeRun = useCallback(() => {
    audio.click();
    gameRef.current?.setManualPause(false);
    setPaused(false);
  }, [audio]);

  /** Leave a paused round for the menu. The gold of an unfinished run is not banked (same as before). */
  const quitRun = useCallback(() => {
    audio.click();
    gameRef.current?.stop();
    setPaused(false);
    setPhase("menu");
  }, [audio]);

  // ── shopkeeper reactions ──
  const react = useCallback((next: Mood, text: string, hold = 1700) => {
    setMood(next);
    setLine(text);
    setLineKey((k) => k + 1);
    moodTimer.run(() => setMood("smile"), hold);
  }, [moodTimer]);

  /** Enter the tavern: reset the keeper to her greeting. */
  const openShop = useCallback(() => {
    audio.shopBell();
    setMood("smile");
    setLine(LINES.idle[0]);
    setLineKey((k) => k + 1);
    setPhase("shop");
  }, [audio]);

  useEffect(() => {
    if (phase !== "shop") return;
    let blinkT: ReturnType<typeof setTimeout>;
    let talkT: ReturnType<typeof setTimeout>;
    const blink = () => {
      setMood((m) => (m === "smile" ? "blink" : m));
      setTimeout(() => setMood((m) => (m === "blink" ? "smile" : m)), 140);
      blinkT = setTimeout(blink, 2600 + Math.random() * 3200);
    };
    const talk = () => {
      setLine((cur) => {
        let n = pick(LINES.idle);
        for (let i = 0; i < 4 && n === cur; i++) n = pick(LINES.idle);
        return n;
      });
      setLineKey((k) => k + 1);
      talkT = setTimeout(talk, 9000);
    };
    blinkT = setTimeout(blink, 2200);
    talkT = setTimeout(talk, 9000);
    return () => { clearTimeout(blinkT); clearTimeout(talkT); moodTimer.clear(); };
  }, [phase, moodTimer]);

  const buyItem = useCallback((id: string, price: number) => {
    if (save.coins < price) {
      audio.deny();
      react("pout", pick(LINES.broke), 2000);
      return;
    }
    audio.buy();
    react("excited", pick(LINES.thanks), 1900);
    setBounceKey((k) => k + 1);
    setSave((s) => {
      if (s.coins < price) return s;
      const next = { ...s, coins: s.coins - price };
      if (id in PADDLE_SKINS && !next.ownedPaddles.includes(id)) next.ownedPaddles = [...next.ownedPaddles, id];
      if (id in BALL_SKINS && !next.ownedBalls.includes(id)) next.ownedBalls = [...next.ownedBalls, id];
      if (id in COURT_SKINS && !next.ownedCourts.includes(id)) next.ownedCourts = [...next.ownedCourts, id];
      if (id in PETS && !next.ownedPets.includes(id)) next.ownedPets = [...next.ownedPets, id];
      return next;
    });
  }, [react, save.coins, audio]);

  const equipItem = useCallback((id: string) => {
    audio.equip();
    react("wink", pick(LINES.equip), 1500);
    setSave((s) => {
      if (id in PADDLE_SKINS && s.ownedPaddles.includes(id)) return { ...s, equippedPaddle: id };
      if (id in BALL_SKINS && s.ownedBalls.includes(id)) return { ...s, equippedBall: id };
      if (id in COURT_SKINS && s.ownedCourts.includes(id)) return { ...s, equippedCourt: id };
      if (id in PETS && s.ownedPets.includes(id)) return { ...s, equippedPet: id as PetType };
      return s;
    });
  }, [react, audio]);

  const buyUpgrade = useCallback((upgrade: UpgradeDef) => {
    const level = save.upgrades[upgrade.id] ?? 0;
    if (level >= upgrade.maxLevel) return;
    const price = Math.round(upgrade.basePrice * Math.pow(upgrade.priceMult, level));
    if (save.coins < price) {
      audio.deny();
      react("pout", pick(LINES.broke), 2000);
      return;
    }
    audio.buy();
    react("excited", pick(LINES.thanks), 1900);
    setBounceKey((k) => k + 1);
    setSave((s) => {
      const lv = s.upgrades[upgrade.id] ?? 0;
      if (lv >= upgrade.maxLevel) return s;
      const p = Math.round(upgrade.basePrice * Math.pow(upgrade.priceMult, lv));
      if (s.coins < p) return s;
      return { ...s, coins: s.coins - p, upgrades: { ...s.upgrades, [upgrade.id]: lv + 1 } };
    });
  }, [react, save.coins, save.upgrades, audio]);

  const toggleMute = useCallback(() => setSave((s) => ({ ...s, muted: !s.muted })), []);
  const close = useCallback(() => { gameRef.current?.stop(); setPaused(false); setPhase("hidden"); }, []);
  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    const next = !game.isManuallyPaused;
    game.setManualPause(next);
    setPaused(next);
  }, []);
  const equippedPet = PETS[save.equippedPet] ? save.equippedPet : "turtle";

  // Screenshot/QA harness: lets a script jump between screens. Inert unless it sets the flag first.
  useEffect(() => {
    const w = window as unknown as { __PONG_HARNESS__?: boolean; __pongUi?: unknown };
    if (!w.__PONG_HARNESS__) return;
    w.__pongUi = {
      setPhase,
      setSave: (patch: Partial<SaveData>) => setSave((s) => ({ ...s, ...patch })),
      openDraft: () => {
        setDraftChoices([PERKS[0], PERKS[3], PERKS[6]]);
        setRunPerks({ bigRacket: 1 });
        setPhase("draft");
      },
      openGameOver: (round: number, coins: number) => { setResultRound(round); setResultCoins(coins); setPhase("gameover"); },
      shopTab: setShopTab,
      openShop,
      react,
    };
  }, [react, openShop]);

  if (phase === "hidden") return null;

  const art = (name: string) => `url(/pong/${name}.webp)`;

  // In play these sit at the head of the foe's rail beside the court; everywhere else, in the window corner.
  const controls = (
    <>
      {phase === "playing" && (
        <button onClick={togglePause} className="kp-icon-btn" aria-label={paused ? "Resume" : "Pause"} aria-pressed={paused} title="Pause (Esc / P)">
          <PauseIcon />
        </button>
      )}
      <button onClick={toggleMute} className="kp-icon-btn" aria-label={save.muted ? "Unmute sound" : "Mute sound"} aria-pressed={save.muted}>
        <SpeakerIcon muted={save.muted} />
      </button>
      <button onClick={close} className="kp-icon-btn" aria-label="Close game"><CloseIcon /></button>
    </>
  );

  return (
    <>
      <style>{popStyle}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pong Quest"
        className="kp-overlay fixed inset-0 z-[9999] flex items-center justify-center select-none overflow-hidden"
        onPointerDown={() => audio.ensure()}
      >
        {phase !== "playing" && <div className="kp-corner">{controls}</div>}

        {/* ─── MENU ─── */}
        {phase === "menu" && (
          <div className="kp-menu">
            <div className="kp-menu-art" style={{ backgroundImage: art("title") }} />
            <div className="kp-wordmark">
              <h1>Pong Quest</h1>
              <div className="kp-sub">Paddle Dungeon</div>
            </div>
            <div className="kp-menu-bar kp-panel">
              <div className="kp-row-main">
                <div className="kp-stats">
                  <div className="kp-stat"><div className="kp-eyebrow">Best</div><b>R{String(save.bestRound).padStart(2, "0")}</b></div>
                  <div className="kp-stat"><div className="kp-eyebrow">Runs</div><b>{String(save.totalRuns).padStart(3, "0")}</b></div>
                  <div className="kp-stat"><div className="kp-eyebrow">Gold</div><Gold amount={save.coins} /></div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={startRun} className="kp-btn kp-btn-primary"><SparkleIcon />Start Run</button>
                  <button onClick={openShop} className="kp-btn">Tavern</button>
                </div>
              </div>
              <div className="kp-hints">
                <span><kbd>MOUSE</kbd> / <kbd>W S</kbd> / <kbd>ARROWS</kbd> move</span>
                <span><kbd>L-CLICK</kbd> familiar</span>
                <span><kbd>HOLD R-CLICK</kbd> slow time</span>
                <span><kbd>ENTER</kbd> start</span>
                <span><kbd>ESC</kbd> / <kbd>P</kbd> pause</span>
                <span><kbd>M</kbd> mute</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── PLAYING ─── */}
        {phase === "playing" && (
          <div className="kp-stage" style={{ ["--kp-rail-x" as string]: PET_RAIL_W / W, ["--kp-rail-r-x" as string]: FOE_RAIL_W / W }}>
            <div className="kp-hud">
              <div className="kp-hud-left">
                <span className="kp-round">ROUND {String(hud.round).padStart(2, "0")}</span>
                <div className="kp-hearts" role="img" aria-label={`${hud.hp} of ${hud.maxHp} hearts`}>
                  {Array.from({ length: hud.maxHp }).map((_, i) => <HeartGem key={i} filled={i < hud.hp} />)}
                </div>
                {hud.hasShield && <span role="img" aria-label="Shield active" title="Shield"><ShieldIcon /></span>}
              </div>
              <div className="kp-score" aria-label={`Score ${hud.points} of ${hud.needed}`}>
                {String(hud.points).padStart(2, "0")}<small>/</small>{String(hud.needed).padStart(2, "0")}
              </div>
              <div className="kp-hud-right">
                <Gold amount={String(hud.coins).padStart(4, "0")} label={`${hud.coins} gold`} />
              </div>
            </div>

            <div className="kp-meters">
              <div className="kp-meter"><HourglassIcon /><span>SLOW TIME</span><Meter value={hud.slowMeter} /><kbd>HOLD R-CLICK</kbd></div>
              <div className="kp-meter">
                <SpriteImg id={`pet-${equippedPet}-0`} height={30} className="kp-pet-mini" />
                <kbd>L-CLICK</kbd><span>{PETS[equippedPet].name}</span><Meter value={1 - hud.petCooldown} tone="violet" />
              </div>
            </div>

            <div className="kp-frame" style={{ ["--kp-bleed-x" as string]: FX_BLEED_X / W, ["--kp-bleed-y" as string]: FX_BLEED_Y / H }}>
              <canvas ref={canvasRef} />
              <div className="kp-rail-r">{controls}</div>
              {loading && <div className="kp-loading">LOADING…</div>}
              {paused && (
                <div className="kp-pause" role="dialog" aria-label="Paused">
                  <div className="kp-pause-card kp-panel">
                    <h2 className="kp-title" style={{ fontSize: 30, margin: 0 }}>Paused</h2>
                    <p className="kp-eyebrow" style={{ margin: "6px 0 18px" }}>Round {String(hud.round).padStart(2, "0")} · {hud.points}/{hud.needed}</p>
                    <div className="kp-actions">
                      <button onClick={resumeRun} className="kp-btn kp-btn-primary" autoFocus>Resume</button>
                      <button onClick={quitRun} className="kp-btn">Quit run</button>
                    </div>
                    <p className="kp-pause-note">
                      <kbd>ESC</kbd> / <kbd>P</kbd> resume. Quitting forfeits the {hud.coins} gold earned this run.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="kp-tip">
              <span>Score {hud.needed} to advance</span>
              <span>Power-ups in the centre</span>
              <span>Catch monsters for loot</span>
              <span>Hit with the blade, not the grip</span>
              <span><kbd>ESC</kbd> / <kbd>P</kbd> pause</span>
            </div>
          </div>
        )}

        {/* ─── DRAFT ─── */}
        {phase === "draft" && (
          <div className="kp-center">
            <div className="kp-bg-art" style={{ backgroundImage: art("title") }} />
            <div className="kp-draft kp-panel">
              <h2 className="kp-title" style={{ fontSize: 30, margin: "0 0 4px" }}>Room Cleared</h2>
              <p className="kp-eyebrow" style={{ margin: "0 0 20px" }}>Choose one relic</p>
              <div className="kp-draft-body">
                <SpriteImg id="shopkeeper-full" height={380} className="kp-keeper-full" />
                <div className="kp-cards">
                  {draftChoices.map((perk, i) => {
                    const stacks = runPerks[perk.id] ?? 0;
                    return (
                      <button key={perk.id} onClick={() => pickPerk(perk)} className="kp-cardbtn" aria-label={`${perk.name}: ${perk.desc}`} aria-keyshortcuts={String(i + 1)}>
                        <span className="kp-cardkey" aria-hidden>{i + 1}</span>
                        <Badge kind={perk.icon} size={76} />
                        <div className="kp-card-name">{perk.name}</div>
                        <div className="kp-card-desc">{perk.desc}</div>
                        <Pips level={stacks} max={perk.maxStacks} next />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}><Gold amount={runCoinsDisplay} suffix="earned" /></div>
              <p className="kp-eyebrow" style={{ margin: "10px 0 0", opacity: 0.7 }}>Press 1, 2 or 3 to choose</p>
            </div>
          </div>
        )}

        {/* ─── GAME OVER ─── */}
        {phase === "gameover" && (
          <div className="kp-center">
            <div className="kp-bg-art" style={{ backgroundImage: art("title") }} />
            <div className="kp-over kp-panel">
              <SpriteImg id={`pet-${equippedPet}-0`} height={120} className="kp-over-pet" />
              <h2>Defeated</h2>
              <p className="kp-eyebrow" style={{ margin: 0 }}>You reached round {resultRound}</p>
              <div className="kp-over-stats">
                <div className="kp-stat"><div className="kp-eyebrow">Round</div><b>{String(resultRound).padStart(2, "0")}</b></div>
                <div className="kp-stat"><div className="kp-eyebrow">Gold</div><Gold amount={resultCoins} /></div>
                {resultRound >= save.bestRound && resultRound > 0 && (
                  <div style={{ display: "flex", alignItems: "center" }}><span className="kp-newbest"><SparkleIcon />New best!</span></div>
                )}
              </div>
              <div className="kp-actions">
                <button onClick={startRun} className="kp-btn kp-btn-primary"><SparkleIcon />Start Run</button>
                <button onClick={openShop} className="kp-btn">Tavern</button>
                <button onClick={() => { audio.click(); setPhase("menu"); }} className="kp-btn">Menu</button>
              </div>
            </div>
          </div>
        )}

        {/* ─── SHOP ─── */}
        {phase === "shop" && (
          <div className="kp-shop">
            <div className="kp-shop-art" style={{ backgroundImage: art("arenas/shop") }} />
            <div className="kp-keeper">
              <div key={lineKey} className="kp-bubble kp-bubble-in" role="status" aria-live="polite">{line}</div>
              <div className="kp-keeper-frame">
                {/* eslint-disable-next-line @next/next/no-img-element -- bust swaps are driven by events, not layout */}
                <img
                  key={bounceKey}
                  src={`/pong/${MANIFEST.sprites[MOOD_FRAME[mood]]?.file}.webp`}
                  srcSet={`/pong/${MANIFEST.sprites[MOOD_FRAME[mood]]?.file}.webp 1x, /pong/${MANIFEST.sprites[MOOD_FRAME[mood]]?.file}@2x.webp 2x`}
                  alt={`Shopkeeper, ${mood}`}
                  draggable={false}
                  className={bounceKey > 0 && mood === "excited" ? "kp-bounce" : "kp-sway"}
                />
                <span className="kp-keeper-name">Mimi, Tavern Keeper</span>
              </div>
            </div>

            <div className="kp-shop-panel kp-panel">
              <div className="kp-shop-head">
                <h2 className="kp-title">Familiar Tavern</h2>
                <Gold amount={String(save.coins).padStart(5, "0")} label={`${save.coins} gold`} />
              </div>
              <div className="kp-tabs" role="tablist" aria-label="Shop sections">
                {SHOP_TABS.map((tab) => (
                  <button key={tab} onClick={() => { audio.click(); setShopTab(tab); }} aria-pressed={shopTab === tab} className="kp-tab">{TAB_LABEL[tab]}</button>
                ))}
              </div>

              <div className="kp-list">
                {shopTab === "weapons" && Object.entries(PADDLE_SKINS).map(([id, skin]) => (
                  <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedPaddles.includes(id)}
                    equipped={save.equippedPaddle === id} canAfford={save.coins >= skin.price}
                    onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                    preview={<SpriteImg id={`weapon-${id}`} height={50} className="kp-tilt" />} />
                ))}
                {shopTab === "balls" && Object.entries(BALL_SKINS).map(([id, skin]) => (
                  <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedBalls.includes(id)}
                    equipped={save.equippedBall === id} canAfford={save.coins >= skin.price}
                    onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                    preview={<SpriteImg id={`ball-${id}`} height={42} />} />
                ))}
                {shopTab === "courts" && Object.entries(COURT_SKINS).map(([id, skin]) => (
                  <ShopRow key={id} name={skin.name} price={skin.price} owned={save.ownedCourts.includes(id)}
                    equipped={save.equippedCourt === id} canAfford={save.coins >= skin.price}
                    onBuy={() => buyItem(id, skin.price)} onEquip={() => equipItem(id)}
                    // eslint-disable-next-line @next/next/no-img-element -- static arena thumbnail
                    preview={<img src={`/pong/arenas/${id}.webp`} alt="" width={64} height={40} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />} />
                ))}
                {shopTab === "pets" && Object.entries(PETS).map(([id, pet]) => (
                  <ShopRow key={id} name={pet.name} price={pet.price} owned={save.ownedPets.includes(id)}
                    equipped={save.equippedPet === id} canAfford={save.coins >= pet.price}
                    onBuy={() => buyItem(id, pet.price)} onEquip={() => equipItem(id)}
                    desc={pet.desc}
                    preview={<SpriteImg id={`pet-${id}-0`} height={50} flip />} />
                ))}
                {shopTab === "upgrades" && UPGRADES.map((upg) => {
                  const level = save.upgrades[upg.id] ?? 0;
                  const price = Math.round(upg.basePrice * Math.pow(upg.priceMult, level));
                  const maxed = level >= upg.maxLevel;
                  const afford = save.coins >= price;
                  return (
                    <div key={upg.id} className="kp-item">
                      <div className="kp-item-preview"><Badge kind={upg.id} size={44} /></div>
                      <div style={{ flex: 1 }}>
                        <div className="kp-item-name">{upg.name}</div>
                        <div className="kp-item-desc">{upg.desc}</div>
                        <Pips level={level} max={upg.maxLevel} />
                      </div>
                      {maxed ? (
                        <span className="kp-equipped-tag">MAX</span>
                      ) : (
                        <button onClick={() => buyUpgrade(upg)} aria-disabled={!afford}
                          className={`kp-btn kp-btn-small${afford ? " kp-btn-primary" : ""}`}>
                          <Gold plain amount={price} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="kp-shop-foot">
                <button onClick={startRun} className="kp-btn kp-btn-primary"><SparkleIcon />Start Run</button>
                <button onClick={() => { audio.click(); setPhase("menu"); }} className="kp-btn">Menu</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── shop row ─────────────────────────────────────────────────────────────

function ShopRow({ name, price, owned, equipped, canAfford, onBuy, onEquip, preview, desc }: {
  name: string; price: number; owned: boolean; equipped: boolean; canAfford: boolean;
  onBuy: () => void; onEquip: () => void; preview: React.ReactNode; desc?: string;
}) {
  return (
    <div className={`kp-item${equipped ? " equipped" : ""}`}>
      <div className="kp-item-preview">{preview}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kp-item-name">{name}</div>
        {desc ? <div className="kp-item-desc">{desc}</div> : null}
      </div>
      {equipped ? (
        <span className="kp-equipped-tag"><SparkleIcon />EQUIPPED</span>
      ) : owned ? (
        <button onClick={onEquip} className="kp-btn kp-btn-small">Equip</button>
      ) : (
        <button onClick={onBuy} aria-disabled={!canAfford} className={`kp-btn kp-btn-small${canAfford ? " kp-btn-primary" : ""}`}>
          <Gold plain amount={price} />
        </button>
      )}
    </div>
  );
}
