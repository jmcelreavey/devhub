"use client";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Timer, Square, Check, X } from "lucide-react";
import {
  clearFocusSession,
  readFocusSession,
  subscribeFocusSession,
  writeFocusSession,
  type FocusSessionState,
} from "@/lib/focus-session-storage";

const CUSTOM_MIN_MINUTES = 1;
const CUSTOM_MAX_MINUTES = 720;
const PRESETS = [
  { mins: 25, label: "Pomodoro" },
  { mins: 45, label: "Deep work" },
  { mins: 90, label: "Long block" },
];

function parseCustomMinutes(raw: string): { mins: number } | { error: string } {
  const t = raw.trim();
  if (!t) return { error: "Enter a number of minutes." };
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: "Use a whole number of minutes." };
  }
  if (n < CUSTOM_MIN_MINUTES || n > CUSTOM_MAX_MINUTES) {
    return { error: `Use ${CUSTOM_MIN_MINUTES}-${CUSTOM_MAX_MINUTES} minutes.` };
  }
  return { mins: n };
}

function useFocusSession(): FocusSessionState | null {
  return useSyncExternalStore(
    subscribeFocusSession,
    () => readFocusSession(),
    () => null,
  );
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Short two-tone chime (perfect fifth up) — noticeable without being shrill. */
function scheduleFocusCompletionChime(ctx: AudioContext): void {
  const t0 = ctx.currentTime;
  const note = (when: number, freqHz: number, durationSec: number, peak: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freqHz, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + durationSec + 0.025);
  };
  // C5 then G5 — ~350ms total, reads as “finished” without alarm-clock energy.
  note(t0, 523.25, 0.13, 0.11);
  note(t0 + 0.11, 783.99, 0.22, 0.09);
}

/**
 * Tiny focus session timer. Shows in the global top bar. Click to start a session;
 * click again to stop. State is persisted so a refresh keeps the countdown.
 */
export function FocusTimer() {
  const session = useFocusSession();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCoords, setPickerCoords] = useState<{ top: number; right: number } | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("");
  const [customError, setCustomError] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const completeDismissRef = useRef<HTMLButtonElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const expiredRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }, []);

  const playCompletionChime = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    scheduleFocusCompletionChime(ctx);
  }, [ensureAudioContext]);

  const playCompletionChimeRef = useRef(playCompletionChime);
  useEffect(() => {
    playCompletionChimeRef.current = playCompletionChime;
  }, [playCompletionChime]);

  useEffect(() => {
    if (!session) return;
    expiredRef.current = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      // Auto-end when the timer hits zero — done inline in the tick rather
      // than in a derived effect so we don't loop on `now`.
      if (!expiredRef.current && t >= session.endsAt) {
        expiredRef.current = true;
        clearFocusSession();
        playCompletionChimeRef.current();
        setCompleteOpen(true);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification("Focus complete", { body: "Time's up - take a break." });
          } catch {
            // Notification constructor may throw on unsupported platforms.
          }
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Click is "inside" if it's on the trigger or the portalled popover.
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  // When the picker opens, anchor the portalled popover to the trigger's
  // current position. Close on viewport changes (resize/scroll) — the
  // popover is small and re-anchoring is more code than it's worth.
  useEffect(() => {
    if (!pickerOpen) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const close = () => setPickerOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pickerOpen]);

  const dismissComplete = useCallback(() => {
    setCompleteOpen(false);
  }, []);

  useEffect(() => {
    if (!completeOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismissComplete();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const raf = requestAnimationFrame(() => {
      completeDismissRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [completeOpen, dismissComplete]);

  const closeCustomModal = useCallback(() => {
    setCustomModalOpen(false);
    setCustomMinutes("");
    setCustomError("");
  }, []);

  useEffect(() => {
    if (!customModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCustomModal();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const raf = requestAnimationFrame(() => {
      customInputRef.current?.focus();
      customInputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [customModalOpen, closeCustomModal]);

  const start = useCallback((mins: number) => {
    const startedAt = Date.now();
    const totalMs = mins * 60_000;
    const next: FocusSessionState = { endsAt: startedAt + totalMs, totalMs };
    const audioCtx = ensureAudioContext();
    if (audioCtx && audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    writeFocusSession(next);
    setNow(startedAt);
    setPickerOpen(false);
    setCustomModalOpen(false);
    setCustomMinutes("");
    setCustomError("");
  }, [ensureAudioContext]);

  const stop = useCallback(() => {
    clearFocusSession();
    setNow(null);
  }, []);

  const submitCustomDuration = useCallback(() => {
    const parsed = parseCustomMinutes(customMinutes);
    if ("error" in parsed) {
      setCustomError(parsed.error);
      return;
    }
    start(parsed.mins);
  }, [customMinutes, start]);

  const customModalPortal =
    customModalOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 9400, background: "rgba(0,0,0,0.4)" }}
        onClick={closeCustomModal}
        role="presentation"
      >
        <div
          className="rounded-lg p-5 w-full max-w-md shadow-xl"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="focus-custom-modal-title"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 id="focus-custom-modal-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Custom duration
            </h3>
            <button type="button" onClick={closeCustomModal} aria-label="Close">
              <X size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
            </button>
          </div>

          <input
            ref={customInputRef}
            type="number"
            inputMode="numeric"
            min={CUSTOM_MIN_MINUTES}
            max={CUSTOM_MAX_MINUTES}
            value={customMinutes}
            onChange={(e) => {
              setCustomMinutes(e.target.value);
              setCustomError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCustomDuration();
              }
            }}
            placeholder="Minutes"
            className="input w-full mb-2"
            autoComplete="off"
          />

          <p className="text-xs mb-3" style={{ color: "var(--text-subtle)" }}>
            Whole minutes, {CUSTOM_MIN_MINUTES}-{CUSTOM_MAX_MINUTES} ({Math.floor(CUSTOM_MAX_MINUTES / 60)}h max).
          </p>

          {customError && (
            <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
              {customError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeCustomModal} className="btn btn-ghost text-xs">
              Cancel
            </button>
            <button type="button" onClick={submitCustomDuration} className="btn btn-primary text-xs">
              Start
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  const completePortal =
    completeOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="focus-complete-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) dismissComplete();
        }}
      >
        <div
          className="card focus-complete-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="focus-complete-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="focus-complete-icon" aria-hidden>
            <Check size={28} strokeWidth={2.5} />
          </div>
          <h2 id="focus-complete-title" className="focus-complete-title">
            Focus block complete
          </h2>
          <p className="focus-complete-body">
            {"Time's up - step away, stretch, or start another block when you're ready."}
          </p>
          <button
            ref={completeDismissRef}
            type="button"
            className="btn btn-primary focus-complete-dismiss"
            onClick={dismissComplete}
          >
            Dismiss
          </button>
        </div>
      </div>,
      document.body,
    );

  if (session && now !== null) {
    const remaining = Math.max(0, session.endsAt - now);
    const pct = 1 - remaining / session.totalMs;
    return (
      <button
        type="button"
        className="focus-pill running"
        onClick={stop}
        title="End focus session"
        style={{
          background: `linear-gradient(90deg, var(--accent-dim) ${pct * 100}%, transparent ${pct * 100}%)`,
        }}
      >
        <Square size={11} aria-hidden />
        <span className="font-mono">{fmtMs(remaining)}</span>
      </button>
    );
  }

  return (
    <>
      <div ref={ref} className="focus-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="focus-pill"
        onClick={() => {
          if (pickerOpen) {
            setPickerOpen(false);
            setPickerCoords(null);
            return;
          }
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) {
            setPickerCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
          }
          setPickerOpen(true);
        }}
        title="Start focus session"
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
      >
        <Timer size={11} aria-hidden />
        <span>Focus</span>
      </button>
      {pickerOpen && pickerCoords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            className="focus-popover"
            role="menu"
            style={{ top: pickerCoords.top, right: pickerCoords.right }}
          >
            {PRESETS.map((p) => (
              <button
                key={p.mins}
                type="button"
                role="menuitem"
                className="focus-preset"
                onClick={() => start(p.mins)}
              >
                <span>{p.label}</span>
                <span className="focus-preset-mins">{p.mins}m</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="focus-preset focus-preset-custom"
              onClick={() => {
                setPickerOpen(false);
                setPickerCoords(null);
                setCustomMinutes("");
                setCustomError("");
                setCustomModalOpen(true);
              }}
            >
              <span>Custom…</span>
              <span className="focus-preset-mins">-</span>
            </button>
          </div>,
          document.body,
        )}
      </div>
      {customModalPortal}
      {completePortal}
    </>
  );
}
