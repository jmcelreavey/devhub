// Fantasy-anime JRPG UI for Pong Quest. Scoped under .kp-overlay, system
// fonts only (rounded Japanese gothic for body, serif display for titles).

const ORNAMENT = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><path d='M9 1 L16 9 L9 17 L2 9Z' fill='#f6d37a' stroke='#3a2306' stroke-width='1.5'/><path d='M9 5 L12 9 L9 13 L6 9Z' fill='#fff4d6'/></svg>",
);

export const popStyle = `
.kp-overlay {
  --kp-gold: #f6d37a;
  --kp-gold-hi: #fff1b8;
  --kp-gold-deep: #b98a2e;
  --kp-ink: #120b24;
  --kp-panel-a: rgba(52, 30, 100, 0.95);
  --kp-panel-b: rgba(24, 13, 50, 0.97);
  --kp-cream: #fff4d6;
  --kp-violet: #b79bff;
  --kp-rose: #ff7aa8;
  --kp-sky: #7fd1ff;
  --kp-font: "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Nunito", "Varela Round", "Trebuchet MS", system-ui, sans-serif;
  --kp-display: "Palatino Linotype", "Book Antiqua", Palatino, "Hiragino Mincho ProN", Georgia, serif;
  font-family: var(--kp-font);
  color: var(--kp-cream);
  background: radial-gradient(120% 90% at 50% 20%, #2a1650 0%, #120a26 60%, #08040f 100%);
  -webkit-font-smoothing: antialiased;
}
.kp-overlay *, .kp-overlay *::before, .kp-overlay *::after { box-sizing: border-box; }
.kp-overlay button { font-family: inherit; cursor: pointer; }
.kp-overlay button:disabled { cursor: default; }
.kp-overlay button:focus-visible { outline: 3px solid var(--kp-sky); outline-offset: 2px; }

/* ── panels ── */
.kp-panel {
  position: relative;
  border-radius: 18px;
  background:
    url("data:image/svg+xml,${ORNAMENT}") left -6px top -6px / 18px 18px no-repeat,
    url("data:image/svg+xml,${ORNAMENT}") right -6px top -6px / 18px 18px no-repeat,
    url("data:image/svg+xml,${ORNAMENT}") left -6px bottom -6px / 18px 18px no-repeat,
    url("data:image/svg+xml,${ORNAMENT}") right -6px bottom -6px / 18px 18px no-repeat,
    linear-gradient(180deg, var(--kp-panel-a), var(--kp-panel-b));
  box-shadow:
    0 0 0 2px #2a1604,
    0 0 0 4px var(--kp-gold-deep),
    0 0 0 5px #2a1604,
    inset 0 0 0 2px rgba(255, 236, 170, 0.22),
    inset 0 18px 40px rgba(160, 120, 255, 0.08),
    0 22px 60px rgba(0, 0, 0, 0.55);
}
.kp-panel::before {
  content: "";
  position: absolute;
  inset: 7px;
  border: 1px solid rgba(246, 211, 122, 0.4);
  border-radius: 12px;
  pointer-events: none;
}

.kp-title {
  font-family: var(--kp-display);
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--kp-gold-hi);
  text-shadow: 0 2px 0 #3a1c00, 0 0 14px rgba(255, 190, 70, 0.4);
}

.kp-eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255, 244, 214, 0.7);
}

/* ── buttons ── */
.kp-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 24px;
  border-radius: 999px;
  border: 2px solid #3a2306;
  font-family: var(--kp-display);
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--kp-cream);
  background: linear-gradient(180deg, #4b2f92, #2a1768);
  box-shadow: inset 0 0 0 2px rgba(246, 211, 122, 0.55), inset 0 -4px 0 rgba(0, 0, 0, 0.3), 0 4px 0 #1a0f33, 0 8px 18px rgba(0, 0, 0, 0.4);
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), filter 140ms, box-shadow 140ms;
}
.kp-btn:hover:not(:disabled):not([aria-disabled="true"]) { transform: translateY(-2px); filter: brightness(1.12); }
.kp-btn:active:not(:disabled) { transform: translateY(2px); box-shadow: inset 0 0 0 2px rgba(246, 211, 122, 0.55), inset 0 -2px 0 rgba(0, 0, 0, 0.3), 0 1px 0 #1a0f33; }
.kp-btn-primary {
  color: #3a1f00;
  text-shadow: 0 1px 0 rgba(255, 250, 220, 0.7);
  background: linear-gradient(180deg, #fff1b8 0%, #f0c04a 48%, #c9881a 100%);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.45), inset 0 -4px 0 rgba(120, 60, 0, 0.35), 0 4px 0 #5c3500, 0 10px 22px rgba(0, 0, 0, 0.45), 0 0 26px rgba(255, 200, 80, 0.28);
}
.kp-btn[aria-disabled="true"], .kp-btn:disabled { filter: saturate(0.5) brightness(0.8); }
.kp-btn-small { min-height: 36px; padding: 7px 16px; font-size: 13px; }

.kp-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 12px;
  color: var(--kp-gold);
  background: rgba(18, 9, 40, 0.78);
  border: 2px solid #3a2306;
  box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.5);
  transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), filter 140ms;
}
.kp-icon-btn:hover { transform: translateY(-1px); filter: brightness(1.2); }

/* ── menu ── */
.kp-menu { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: clamp(14px, 4vh, 40px) 16px clamp(14px, 3.5vh, 36px); }
.kp-menu-art { position: absolute; inset: 0; background-size: cover; background-position: center 38%; }
.kp-menu-art::after {
  content: ""; position: absolute; inset: 0;
  background:
    linear-gradient(180deg, rgba(10, 5, 24, 0.55) 0%, rgba(10, 5, 24, 0) 28%, rgba(10, 5, 24, 0) 56%, rgba(10, 5, 24, 0.86) 100%),
    radial-gradient(90% 70% at 50% 45%, rgba(0, 0, 0, 0) 55%, rgba(5, 2, 14, 0.55) 100%);
}
.kp-wordmark { position: relative; text-align: center; }
.kp-wordmark h1 {
  margin: 0;
  font-family: var(--kp-display);
  font-weight: 900;
  font-size: clamp(40px, 8vw, 92px);
  letter-spacing: 0.06em;
  line-height: 1;
  text-transform: uppercase;
  background: linear-gradient(180deg, #fffbe6 0%, #ffe28a 38%, #f0b02a 58%, #b86a00 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  -webkit-text-stroke: 2px #3a1c00;
  paint-order: stroke fill;
  filter: drop-shadow(0 4px 0 #2a0f40) drop-shadow(0 0 22px rgba(255, 200, 80, 0.5));
}
.kp-wordmark .kp-sub {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  margin-top: 8px;
  font-family: var(--kp-display);
  font-weight: 800;
  font-size: clamp(14px, 2.2vw, 24px);
  letter-spacing: 0.42em;
  color: #e8dcff;
  text-shadow: 0 2px 0 #1a0b3a, 0 0 12px rgba(160, 120, 255, 0.6);
}
.kp-wordmark .kp-sub::before, .kp-wordmark .kp-sub::after {
  content: ""; height: 2px; width: clamp(30px, 8vw, 110px);
  background: linear-gradient(90deg, transparent, var(--kp-gold), transparent);
}
.kp-menu-bar {
  position: relative;
  width: min(920px, 100%);
  padding: 16px 22px 14px;
  display: flex; flex-direction: column; gap: 14px; align-items: center;
}
.kp-menu-bar .kp-row-main { display: flex; flex-wrap: wrap; gap: 16px 28px; align-items: center; justify-content: center; }
.kp-stats { display: flex; gap: 10px; }
.kp-stat {
  min-width: 92px; padding: 7px 12px 6px; text-align: center;
  border-radius: 12px;
  background: rgba(10, 5, 24, 0.55);
  box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.4);
}
.kp-stat .kp-eyebrow { font-size: 10.5px; }
.kp-stat b { display: block; font-family: var(--kp-display); font-size: 24px; font-weight: 900; color: var(--kp-gold-hi); line-height: 1.15; text-shadow: 0 2px 0 #3a1c00; }
.kp-hints { font-size: 12px; letter-spacing: 0.1em; color: rgba(255, 244, 214, 0.62); display: flex; flex-wrap: wrap; gap: 4px 18px; justify-content: center; }
.kp-hints kbd { font-family: inherit; font-weight: 800; color: var(--kp-gold); }

/* ── HUD / stage ── */
/* The familiar's rail sits beside the court's player-side wall, so the court plus its rail is what has to fit.
   --kp-rail-x is rail/court. The right gutter keeps the corner buttons off the HUD. */
.kp-stage { --kp-w: min(calc((100vw - 16px) / (1 + var(--kp-rail-x, 0.19) + var(--kp-rail-r-x, 0.09))), calc((100vh - 178px) * 1.6), 1280px); position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 8px; gap: 8px; }
.kp-hud, .kp-meters, .kp-frame, .kp-tip { margin-left: calc(var(--kp-w) * var(--kp-rail-x, 0.19)); margin-right: calc(var(--kp-w) * var(--kp-rail-r-x, 0.09)); }
/* The foe's rail: the run controls sit at its head, the guardian below them is drawn on the canvas. */
.kp-rail-r {
  position: absolute; top: 8px; left: calc(100% + 11px); width: calc(var(--kp-w) * var(--kp-rail-r-x, 0.09) - 14px);
  display: flex; flex-direction: column; align-items: center; gap: 6px; z-index: 5;
}
.kp-rail-r .kp-icon-btn { width: 32px; height: 32px; border-radius: 10px; }
.kp-stage::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(70% 60% at 50% 50%, rgba(80, 40, 160, 0.18), rgba(0, 0, 0, 0.6));
}
.kp-hud {
  position: relative;
  width: var(--kp-w);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;
  padding: 7px 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(52, 30, 100, 0.92), rgba(24, 13, 50, 0.95));
  box-shadow: 0 0 0 2px #2a1604, 0 0 0 3.5px var(--kp-gold-deep), inset 0 0 0 1.5px rgba(255, 236, 170, 0.2);
}
.kp-hud-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.kp-hud-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.kp-round {
  padding: 4px 12px; border-radius: 999px;
  font-family: var(--kp-display); font-weight: 900; font-size: 14px; letter-spacing: 0.14em; color: #2a1200;
  background: linear-gradient(180deg, #fff1b8, #e2a82a);
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.5), 0 2px 0 #5c3500;
  white-space: nowrap;
}
.kp-hearts { display: flex; gap: 1px; align-items: center; }
.kp-score {
  font-family: var(--kp-display); font-weight: 900; font-size: 30px; letter-spacing: 0.06em; line-height: 1;
  color: var(--kp-gold-hi); text-shadow: 0 2px 0 #3a1c00, 0 0 14px rgba(255, 190, 70, 0.45);
  padding: 0 10px;
}
.kp-score small { font-size: 18px; opacity: 0.65; margin: 0 4px; }
/* One coin, everywhere: 1em square, a fixed gap, centred on the digits' cap height. Gold figures are
   <Gold>; line-height 1 keeps the row as tall as the font so the coin and digits share a centre. */
.kp-gold, .kp-price { display: inline-flex; align-items: center; gap: 0.3em; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
.kp-gold { font-family: var(--kp-display); font-weight: 900; font-size: 20px; color: var(--kp-gold-hi); text-shadow: 0 2px 0 #3a1c00; }
.kp-coin { display: block; flex: none; width: 1.05em; height: 1.05em; transform: translateY(var(--kp-coin-nudge, -0.04em)); filter: drop-shadow(0 1px 0 rgba(42, 22, 4, 0.55)); }
.kp-gold-suffix { margin-left: 0.2em; font-size: 0.8em; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85; }
.kp-stat .kp-gold { display: flex; justify-content: center; font-size: 24px; line-height: 1.15; }
.kp-meters { position: relative; width: var(--kp-w); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.kp-meter:last-child { margin-left: auto; }
.kp-meter { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.1em; color: rgba(255, 244, 214, 0.85); }
.kp-bar { width: 118px; height: 12px; border-radius: 999px; background: rgba(10, 5, 24, 0.8); box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.55); padding: 2px; }
.kp-bar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(180deg, #fff1b8, #e2a82a); }
.kp-bar.kp-bar-violet > i { background: linear-gradient(180deg, #e0d2ff, #8a5cff); }
.kp-pet-mini { width: 30px; height: 30px; object-fit: contain; transform: scaleX(-1); filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5)); }
.kp-frame {
  position: relative;
  width: var(--kp-w);
  aspect-ratio: 8 / 5;
  border-radius: 12px;
  overflow: visible;
  box-shadow: 0 0 0 2px #2a1604, 0 0 0 5px var(--kp-gold-deep), 0 0 0 7px #2a1604, 0 18px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(130, 80, 255, 0.2);
  background: #000;
}
/* The bitmap is larger than the court so sparks can leave the frame. --kp-bleed-* is bleed/court. */
.kp-frame canvas {
  position: absolute; left: 50%; top: 50%;
  width: calc(100% * (1 + 2 * var(--kp-bleed-x, 0.25)));
  height: calc(100% * (1 + 2 * var(--kp-bleed-y, 0.28)));
  transform: translate(-50%, -50%);
  display: block; cursor: none; max-width: none;
}
.kp-tip { position: relative; max-width: var(--kp-w); display: flex; flex-wrap: wrap; gap: 4px 20px; justify-content: center; font-size: 12px; letter-spacing: 0.1em; color: rgba(255, 244, 214, 0.6); }
.kp-tip kbd, .kp-meter kbd, .kp-pause-note kbd {
  font-family: inherit; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; padding: 1px 6px; border-radius: 6px;
  color: var(--kp-gold); background: rgba(20, 10, 44, 0.7); border: 1px solid rgba(246, 211, 122, 0.4);
}
.kp-pause { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; background: rgba(10, 6, 24, 0.55); border-radius: 12px; cursor: default; }
.kp-pause-card { width: min(380px, 86%); padding: 24px 28px 18px; text-align: center; animation: kp-card-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.kp-pause-card .kp-actions { justify-content: center; }
.kp-pause-note { margin: 14px 0 0; font-size: 12px; letter-spacing: 0.06em; color: rgba(255, 244, 214, 0.6); }
.kp-cardkey {
  position: absolute; top: 10px; left: 10px; width: 24px; height: 24px; display: grid; place-items: center;
  border-radius: 8px; font-family: var(--kp-display); font-weight: 900; font-size: 13px; color: var(--kp-gold-hi);
  background: rgba(20, 10, 44, 0.75); border: 1px solid rgba(246, 211, 122, 0.55);
}
@media (prefers-reduced-motion: reduce) { .kp-pause-card { animation: none; } }
.kp-loading { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--kp-display); font-weight: 800; letter-spacing: 0.2em; color: var(--kp-gold); background: rgba(8, 4, 16, 0.7); }

/* ── top-right controls ── */
.kp-corner { position: absolute; top: 12px; right: 14px; z-index: 20; display: flex; gap: 8px; }

/* ── centre screens (draft / game over) ── */
.kp-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: auto; }
.kp-bg-art { position: absolute; inset: 0; background-size: cover; background-position: center; filter: saturate(0.85) brightness(0.45) blur(1.5px); transform: scale(1.04); }
.kp-bg-art::after { content: ""; position: absolute; inset: 0; background: radial-gradient(80% 70% at 50% 40%, rgba(40, 20, 90, 0.25), rgba(5, 2, 14, 0.75)); }
.kp-draft { position: relative; width: min(980px, 100%); padding: 26px 28px 24px; text-align: center; }
.kp-draft-body { display: flex; gap: 22px; align-items: flex-end; justify-content: center; }
.kp-keeper-full { flex: 0 0 auto; height: min(52vh, 380px); width: auto; margin-left: -8px; margin-bottom: -26px; filter: drop-shadow(0 12px 12px rgba(0, 0, 0, 0.5)); transform-origin: 50% 100%; }
.kp-cards { flex: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-self: center; margin-bottom: 8px; }
.kp-cardbtn {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 12px 18px; min-height: 230px; border-radius: 16px; text-align: center; color: var(--kp-cream);
  background: linear-gradient(180deg, rgba(86, 52, 160, 0.9), rgba(34, 18, 72, 0.95));
  border: 2px solid #3a2306;
  box-shadow: inset 0 0 0 2px rgba(246, 211, 122, 0.5), 0 6px 0 #170b30, 0 14px 24px rgba(0, 0, 0, 0.45);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms, filter 180ms;
  animation: kp-card-in 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.kp-cardbtn:nth-child(2) { animation-delay: 70ms; }
.kp-cardbtn:nth-child(3) { animation-delay: 140ms; }
.kp-cardbtn:hover, .kp-cardbtn:focus-visible { transform: translateY(-6px); filter: brightness(1.12); box-shadow: inset 0 0 0 2px var(--kp-gold-hi), 0 10px 0 #170b30, 0 20px 30px rgba(0, 0, 0, 0.5), 0 0 28px rgba(255, 210, 100, 0.35); }
.kp-cardbtn .kp-card-name { font-family: var(--kp-display); font-weight: 900; font-size: 17px; letter-spacing: 0.1em; color: var(--kp-gold-hi); text-shadow: 0 2px 0 #3a1c00; }
.kp-cardbtn .kp-card-desc { font-size: 14px; color: rgba(255, 244, 214, 0.82); }
.kp-pips { display: flex; gap: 4px; justify-content: center; min-height: 12px; }
.kp-pip { width: 10px; height: 10px; transform: rotate(45deg); border-radius: 2px; background: rgba(10, 5, 24, 0.7); box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.55); }
.kp-pip.on { background: linear-gradient(135deg, #fff1b8, #e2a82a); }
.kp-pip.next { background: rgba(246, 211, 122, 0.35); }

.kp-bubble {
  position: relative; display: inline-block; max-width: 300px;
  padding: 10px 14px; border-radius: 16px;
  font-size: 14px; font-weight: 700; line-height: 1.35;
  color: #3a1f00; text-align: left;
  background: linear-gradient(180deg, #fffaf0, #ffeec8);
  box-shadow: 0 0 0 2px #3a2306, 0 6px 14px rgba(0, 0, 0, 0.4);
}
.kp-bubble::after {
  content: ""; position: absolute; left: 26px; bottom: -11px; width: 18px; height: 18px;
  background: #ffeec8; transform: rotate(45deg);
  border-right: 2px solid #3a2306; border-bottom: 2px solid #3a2306;
}
.kp-bubble.kp-bubble-right::after { left: auto; right: 26px; }
.kp-bubble-in { animation: kp-bubble-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both; }

.kp-over { position: relative; width: min(640px, 100%); padding: 30px 32px 26px; text-align: center; }
.kp-over h2 {
  margin: 0 0 6px; font-family: var(--kp-display); font-weight: 900; font-size: clamp(36px, 7vw, 64px); letter-spacing: 0.1em; text-transform: uppercase;
  background: linear-gradient(180deg, #ffe2e6 0%, #ff6a7e 45%, #a3122e 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  -webkit-text-stroke: 2px #3a0612; paint-order: stroke fill;
  filter: drop-shadow(0 3px 0 #1a0510) drop-shadow(0 0 18px rgba(255, 70, 100, 0.4));
}
.kp-over-stats { display: flex; gap: 14px; justify-content: center; align-items: stretch; margin: 20px 0 24px; flex-wrap: wrap; }
.kp-newbest {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px;
  font-family: var(--kp-display); font-weight: 900; letter-spacing: 0.12em; color: #2a1200;
  background: linear-gradient(180deg, #fff1b8, #f0b02a); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.5), 0 3px 0 #5c3500;
}
.kp-over-pet { position: absolute; left: 22px; top: -74px; width: 120px; transform: scaleX(-1); filter: drop-shadow(0 8px 8px rgba(0, 0, 0, 0.5)); pointer-events: none; }
.kp-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

/* ── shop ── */
.kp-shop { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 28px; padding: 20px; overflow: auto; }
.kp-shop-art { position: absolute; inset: 0; background-size: cover; background-position: center; filter: brightness(0.55) saturate(1.05); }
.kp-shop-art::after { content: ""; position: absolute; inset: 0; background: radial-gradient(70% 70% at 40% 50%, rgba(255, 190, 90, 0.12), rgba(6, 3, 14, 0.72)); }
.kp-keeper { position: relative; flex: 0 0 auto; width: min(300px, 32vw); display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.kp-keeper-frame {
  position: relative; width: 100%; aspect-ratio: 3 / 4;
  border-radius: 20px; overflow: hidden;
  background: radial-gradient(90% 80% at 50% 30%, #4a2f86, #1c0f3d);
  box-shadow: 0 0 0 2px #2a1604, 0 0 0 5px var(--kp-gold-deep), 0 0 0 7px #2a1604, 0 20px 40px rgba(0, 0, 0, 0.55);
}
.kp-keeper-frame img { position: absolute; left: 50%; bottom: 0; height: 104%; width: auto; transform: translateX(-50%); transform-origin: 50% 100%; user-select: none; -webkit-user-drag: none; }
.kp-keeper-name { position: absolute; left: 10px; bottom: 10px; z-index: 2; padding: 4px 12px; border-radius: 999px; font-family: var(--kp-display); font-weight: 900; font-size: 13px; letter-spacing: 0.12em; color: #2a1200; background: linear-gradient(180deg, #fff1b8, #e2a82a); box-shadow: 0 2px 0 #5c3500; }
.kp-sway { animation: kp-sway 4.6s ease-in-out infinite; }
.kp-bounce { animation: kp-bounce 520ms cubic-bezier(0.22, 1, 0.36, 1); }
.kp-shop-panel { position: relative; flex: 1 1 520px; max-width: 640px; padding: 22px 24px 20px; }
.kp-shop-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.kp-shop-head h2 { margin: 0; font-size: 22px; }
.kp-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.kp-tab {
  padding: 7px 16px; border-radius: 999px; font-family: var(--kp-display); font-weight: 800; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255, 244, 214, 0.78); background: rgba(10, 5, 24, 0.55); border: 2px solid transparent;
  box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.25);
  transition: filter 140ms, transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}
.kp-tab:hover { filter: brightness(1.25); }
.kp-tab[aria-pressed="true"] { color: #2a1200; background: linear-gradient(180deg, #fff1b8, #e2a82a); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.5), 0 2px 0 #5c3500; }
.kp-list {
  display: flex; flex-direction: column; gap: 5px;
  max-height: min(62vh, 560px); overflow-y: auto;
  padding: 2px 10px 6px 2px;
  scrollbar-width: thin;
  scrollbar-color: #e2a82a rgba(10, 5, 24, 0.55);
}
.kp-list::-webkit-scrollbar { width: 10px; }
.kp-list::-webkit-scrollbar-track { background: rgba(10, 5, 24, 0.45); border-radius: 99px; }
.kp-list::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #fff1b8, #c9861a);
  border-radius: 99px;
  border: 2px solid #3a2306;
}
.kp-item {
  display: flex; align-items: center; gap: 12px; padding: 5px 10px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(60, 36, 116, 0.55), rgba(26, 14, 54, 0.7));
  box-shadow: inset 0 0 0 1.5px rgba(246, 211, 122, 0.3);
}
.kp-item.equipped { box-shadow: inset 0 0 0 2px var(--kp-gold); background: linear-gradient(180deg, rgba(96, 62, 170, 0.6), rgba(34, 18, 70, 0.75)); }
.kp-item-preview { flex: 0 0 64px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 10px; background: rgba(8, 4, 18, 0.55); box-shadow: inset 0 0 0 1px rgba(246, 211, 122, 0.25); overflow: hidden; }
.kp-item-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.kp-item-preview img.kp-tilt { transform: rotate(40deg) scale(1.05); }
.kp-item-name { font-family: var(--kp-display); font-weight: 900; font-size: 15px; letter-spacing: 0.1em; color: var(--kp-cream); }
.kp-item-desc { font-size: 12.5px; color: rgba(255, 244, 214, 0.7); margin-top: 2px; }
.kp-equipped-tag { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-family: var(--kp-display); font-weight: 900; font-size: 12px; letter-spacing: 0.14em; color: var(--kp-gold-hi); }
.kp-shop-foot { display: flex; gap: 12px; justify-content: center; margin-top: 16px; }

@keyframes kp-card-in { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes kp-bubble-in { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes kp-sway { 0%, 100% { transform: translateX(-50%) rotate(-0.9deg) translateY(0); } 50% { transform: translateX(-50%) rotate(0.9deg) translateY(-3px); } }
@keyframes kp-bounce { 0% { transform: translateX(-50%) translateY(0) scale(1, 1); } 30% { transform: translateX(-50%) translateY(-18px) scale(0.96, 1.05); } 55% { transform: translateX(-50%) translateY(0) scale(1.05, 0.94); } 100% { transform: translateX(-50%) translateY(0) scale(1, 1); } }
@keyframes kp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }

/* the court plus its familiar rail leaves the HUD bar narrow: let it compact before it collides */
@media (max-width: 680px) {
  .kp-hud { padding: 6px 10px; gap: 6px; }
  .kp-hud-left { gap: 6px; }
  .kp-round { padding: 3px 8px; font-size: 11px; letter-spacing: 0.08em; }
  .kp-hearts svg { width: 17px; height: 17px; }
  .kp-score { font-size: 22px; padding: 0; }
  .kp-score small { font-size: 14px; margin: 0 2px; }
  .kp-gold { font-size: 15px; }
}

@media (max-width: 760px) {
  .kp-draft-body { flex-direction: column; align-items: center; }
  .kp-cards { grid-template-columns: 1fr; width: 100%; }
  .kp-keeper-full { display: none; }
  .kp-shop { flex-direction: column; justify-content: flex-start; }
  .kp-keeper { width: min(240px, 60vw); }
}

@media (prefers-reduced-motion: reduce) {
  .kp-overlay *, .kp-overlay *::before, .kp-overlay *::after { animation: none !important; transition: none !important; }
}
body[data-motion="off"] .kp-overlay *, body[data-motion="off"] .kp-overlay *::before, body[data-motion="off"] .kp-overlay *::after { animation: none !important; transition: none !important; }
`;
