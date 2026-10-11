// Anime-style relic badges and HUD glyphs, drawn as SVG in the game's palette.
// Nothing here is a text character standing in for an icon.

import { useId } from "react";
import { COIN_BOX, COIN_GLINT, COIN_GRADIENT, COIN_RIM, COIN_RING, COIN_STAR, COIN_STAR_FILL } from "./coin";

type Tone = { a: string; b: string; glyph: string };

const TONES: Record<string, Tone> = {
  bigRacket: { a: "#7be07b", b: "#1f8a3b", glyph: "#f4fff0" },
  slowBall: { a: "#8fb8ff", b: "#2a4fb3", glyph: "#eef4ff" },
  powerUp: { a: "#b7f06a", b: "#2f9a2f", glyph: "#fbffe8" },
  greedy: { a: "#ffd75e", b: "#c27a00", glyph: "#fff8d6" },
  secondWind: { a: "#8fe3ff", b: "#1d76b8", glyph: "#f0fbff" },
  tanky: { a: "#ff8f9c", b: "#b3153a", glyph: "#fff1f3" },
  curveball: { a: "#cfa8ff", b: "#6a2bd1", glyph: "#f7f0ff" },
  startHp: { a: "#ff9ab8", b: "#c01851", glyph: "#fff1f6" },
  coinBoost: { a: "#ffcf6a", b: "#b45a0a", glyph: "#fff6dc" },
  powerupFreq: { a: "#e0a8ff", b: "#8a2fc4", glyph: "#fdf3ff" },
};

const INK = "#24103a";

function Glyph({ kind, c }: { kind: string; c: string }) {
  const stroke = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  switch (kind) {
    case "bigRacket":
      return (
        <g>
          <rect x="27" y="19" width="10" height="26" rx="5" fill={c} {...stroke} />
          <path d="M23 18 L32 9 L41 18" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 18 L32 9 L41 18" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 46 L32 55 L41 46" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M23 46 L32 55 L41 46" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "slowBall":
      return (
        <g>
          <path d="M32 40 V44" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <path d="M23 45 H41 L38 54 H26 Z" fill="#aab4c8" {...stroke} />
          <circle cx="32" cy="28" r="12" fill={c} {...stroke} />
          <ellipse cx="28" cy="23.5" rx="4.6" ry="3" fill="#fff" opacity="0.7" transform="rotate(-30 28 23.5)" />
        </g>
      );
    case "powerUp":
      return (
        <g>
          <path d="M32 36 C32 44 36 48 41 50" fill="none" stroke={INK} strokeWidth="4.4" strokeLinecap="round" />
          <path d="M32 36 C32 44 36 48 41 50" fill="none" stroke="#7bd96a" strokeWidth="2.2" strokeLinecap="round" />
          {[[-7, 0], [7, 0], [0, -7], [0, 7]].map(([dx, dy], i) => (
            <circle key={i} cx={32 + dx} cy={28 + dy} r="7.2" fill={c} {...stroke} />
          ))}
          <circle cx="32" cy="28" r="3.4" fill="#ffe27a" {...stroke} />
        </g>
      );
    case "greedy":
      return (
        <g>
          {[46, 39, 32].map((y, i) => (
            <g key={y}>
              <ellipse cx="32" cy={y + 3} rx="14" ry="6" fill="#a86a08" {...stroke} />
              <ellipse cx="32" cy={y} rx="14" ry="6" fill={i === 2 ? "#ffe27a" : c} {...stroke} />
            </g>
          ))}
          <path d="M32 26 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6z" fill="#b9801c" opacity="0.9" transform="translate(0 -1) scale(1)" />
        </g>
      );
    case "secondWind":
      return (
        <g>
          <path d="M32 11 L46 17 V31 C46 41 40 47 32 51 C24 47 18 41 18 31 V17 Z" fill={c} {...stroke} />
          <path d="M23 29 Q28 23 33 29 T43 27" fill="none" stroke="#2a8bd0" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M23 36 Q28 31 33 36 T42 34" fill="none" stroke="#2a8bd0" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    case "tanky":
      return (
        <g>
          <path d="M32 50 C14 38 14 22 24 18 C28 16.500 31 19 32 22 C33 19 36 16.500 40 18 C50 22 50 38 32 50Z" fill={c} {...stroke} />
          <path d="M32 26 V42 M24 33 H40" stroke="#b3153a" strokeWidth="4.2" strokeLinecap="round" />
          <ellipse cx="25" cy="23" rx="3.6" ry="2.4" fill="#fff" opacity="0.65" transform="rotate(-35 25 23)" />
        </g>
      );
    case "curveball":
      return (
        <g>
          <circle cx="23" cy="40" r="9" fill={c} {...stroke} />
          <ellipse cx="20" cy="36.500" rx="3" ry="2" fill="#fff" opacity="0.7" transform="rotate(-30 20 36.5)" />
          <path d="M26 31 C32 14 48 16 50 27" fill="none" stroke={INK} strokeWidth="5.4" strokeLinecap="round" />
          <path d="M26 31 C32 14 48 16 50 27" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" />
          <path d="M44 22 L50.500 27.500 L43 31" fill="none" stroke={INK} strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M44 22 L50.500 27.500 L43 31" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "startHp":
      return (
        <g>
          <path d="M31 50 C13 38 13 22 23 18 C27 16.500 30 19 31 22 C32 19 35 16.500 39 18 C49 22 49 38 31 50Z" fill={c} {...stroke} />
          <ellipse cx="24" cy="23" rx="3.4" ry="2.3" fill="#fff" opacity="0.65" transform="rotate(-35 24 23)" />
          <circle cx="45" cy="19" r="8" fill="#fff4d6" {...stroke} />
          <path d="M45 14.500 V23.500 M40.500 19 H49.500" stroke="#c01851" strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case "coinBoost":
      return (
        <g>
          <path d="M21 17 V33 A11 11 0 0 0 43 33 V17" fill="none" stroke={INK} strokeWidth="9.400" strokeLinecap="butt" />
          <path d="M21 17 V33 A11 11 0 0 0 43 33 V17" fill="none" stroke="#e23d4a" strokeWidth="6.400" strokeLinecap="butt" />
          <rect x="17.500" y="14" width="7" height="8" fill="#e8ecf5" stroke={INK} strokeWidth="1.600" />
          <rect x="39.500" y="14" width="7" height="8" fill="#e8ecf5" stroke={INK} strokeWidth="1.600" />
          <circle cx="32" cy="48" r="6" fill="#ffd75e" {...stroke} />
          <path d="M32 44.500 V51.500" stroke="#a86400" strokeWidth="1.800" strokeLinecap="round" />
        </g>
      );
    case "powerupFreq":
    default:
      return (
        <g>
          <path d="M32 11 L37.500 25 L52 26 L40.500 35.500 L44.500 50 L32 41.500 L19.500 50 L23.500 35.500 L12 26 L26.500 25 Z" fill={c} {...stroke} />
          <ellipse cx="27" cy="24" rx="3.600" ry="2.300" fill="#fff" opacity="0.7" transform="rotate(-30 27 24)" />
        </g>
      );
  }
}

/** Round gilded relic badge for perks and upgrades. */
export function Badge({ kind, size = 64, className }: { kind: string; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const tone = TONES[kind] ?? TONES.powerupFreq;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.5" stopColor="#e2a82a" />
          <stop offset="1" stopColor="#7a4a08" />
        </linearGradient>
        <radialGradient id={`${id}b`} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor={tone.a} />
          <stop offset="1" stopColor={tone.b} />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#${id}r)`} stroke="#3a2306" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="25" fill={`url(#${id}b)`} stroke="#2a1604" strokeWidth="1.2" />
      <ellipse cx="25" cy="17" rx="13" ry="6" fill="#fff" opacity="0.2" transform="rotate(-18 25 17)" />
      <Glyph kind={kind} c={tone.glyph} />
      {[[32, 3], [61, 32], [32, 61], [3, 32]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 4.500} L${x + 3.500} ${y} L${x} ${y + 4.500} L${x - 3.500} ${y} Z`} fill="#ffe9a0" stroke="#5a3a06" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ── HUD glyphs ───────────────────────────────────────────────────────────

export function HeartGem({ filled, size = 22 }: { filled: boolean; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#ffb3c4" />
          <stop offset="0.55" stopColor="#ff3d6a" />
          <stop offset="1" stopColor="#a30f33" />
        </radialGradient>
      </defs>
      <path
        d="M12 21 C3 14.500 2.500 8.500 7 6.500 C9.500 5.400 11.300 6.800 12 8.500 C12.700 6.800 14.500 5.400 17 6.500 C21.500 8.500 21 14.500 12 21Z"
        fill={filled ? `url(#${id})` : "rgba(40,20,60,0.7)"}
        stroke={filled ? "#4a0a1c" : "rgba(255,200,220,0.35)"}
        strokeWidth="1.400"
        strokeLinejoin="round"
      />
      {filled && <ellipse cx="8.600" cy="9" rx="2.200" ry="1.300" fill="#fff" opacity="0.7" transform="rotate(-30 8.6 9)" />}
    </svg>
  );
}

/**
 * The one gold coin. It is 1em square so it scales with the text it sits beside,
 * and `.kp-coin` (styles.ts) centres it on the digits. Art lives in coin.ts so the
 * canvas coin pop is the same coin.
 */
export function Coin({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`kp-coin ${className}`.trim()} viewBox={`0 0 ${COIN_BOX} ${COIN_BOX}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {COIN_GRADIENT.map(([at, color]) => <stop key={at} offset={at} stopColor={color} />)}
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r={COIN_RIM.r} fill={`url(#${id})`} stroke={COIN_RIM.stroke} strokeWidth={COIN_RIM.width} />
      <circle cx="12" cy="12" r={COIN_RING.r} fill="none" stroke={COIN_RING.stroke} strokeWidth={COIN_RING.width} />
      <path d={COIN_STAR} fill={COIN_STAR_FILL} />
      <ellipse cx={COIN_GLINT.cx} cy={COIN_GLINT.cy} rx={COIN_GLINT.rx} ry={COIN_GLINT.ry} fill={COIN_GLINT.fill} transform={`rotate(${(COIN_GLINT.rot * 180) / Math.PI} ${COIN_GLINT.cx} ${COIN_GLINT.cy})`} />
    </svg>
  );
}

/**
 * A coin beside an amount. Every gold figure in the game goes through this, so the
 * coin is always the same size relative to its digits, the same gap away, and
 * centred on them. `plain` inherits the surrounding button's type (shop prices).
 */
export function Gold({ amount, suffix, plain = false, label }: { amount: number | string; suffix?: string; plain?: boolean; label?: string }) {
  return (
    <span className={plain ? "kp-price" : "kp-gold"} aria-label={label}>
      <Coin />
      <span>{amount}</span>
      {suffix ? <span className="kp-gold-suffix">{suffix}</span> : null}
    </span>
  );
}

export function ShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.500 L20 5.500 V12 C20 17 16.500 20.500 12 22 C7.500 20.500 4 17 4 12 V5.500 Z" fill="#ffd75e" stroke="#5a3a06" strokeWidth="1.500" strokeLinejoin="round" />
      <path d="M12 6 V18 M7.500 11 H16.500" stroke="#fff8d6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HourglassIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3 H18 M6 21 H18" stroke="#e2a82a" strokeWidth="2.600" strokeLinecap="round" />
      <path d="M7.500 3.500 C7.500 9 11 10.500 12 12 C13 10.500 16.500 9 16.500 3.500 Z M7.500 20.500 C7.500 15 11 13.500 12 12 C13 13.500 16.500 15 16.500 20.500 Z" fill="#9fd8ff" stroke="#1d4f8a" strokeWidth="1.400" strokeLinejoin="round" />
      <path d="M9.500 19 H14.500 L12 15 Z" fill="#fff4d6" />
    </svg>
  );
}

export function SpeakerIcon({ muted, size = 20 }: { muted: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.500 H8 L13 5 V19 L8 14.500 H4 Z" fill="currentColor" fillOpacity="0.25" />
      {muted ? (
        <path d="M17 9.500 L21.500 14.500 M21.500 9.500 L17 14.500" />
      ) : (
        <>
          <path d="M16.500 9 C17.800 10.600 17.800 13.400 16.500 15" />
          <path d="M19 6.500 C21.500 9.400 21.500 14.600 19 17.500" />
        </>
      )}
    </svg>
  );
}

export function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">
      <rect x="6" y="5" width="4.500" height="14" rx="1.400" />
      <rect x="13.500" y="5" width="4.500" height="14" rx="1.400" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.600" strokeLinecap="round">
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </svg>
  );
}

export function SparkleIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 1 L14.600 9.400 L23 12 L14.600 14.600 L12 23 L9.400 14.600 L1 12 L9.400 9.400Z" fill="currentColor" />
    </svg>
  );
}
