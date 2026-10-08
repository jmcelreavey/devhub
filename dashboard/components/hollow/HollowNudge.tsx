"use client";

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "@/components/shell/ThemeToggle";
import { applyThemeSelection } from "@/lib/theme-presets";
import {
  HOLLOW_NUDGE_KEY,
  HOLLOW_PRESET_ID,
  parseHollowNow,
  readDismissedNudgeYear,
  shouldShowHollowNudge,
} from "@/lib/hollow-theme";

function subscribeNudge(): () => void {
  return () => {};
}

/**
 * Late October only. Never switches the theme on its own, and a dismissal
 * sticks for the calendar year. Styled with the active palette's tokens so it
 * stays readable on whatever preset is showing.
 */
export function HollowNudge() {
  const selection = useTheme();
  const [dismissedNow, setDismissedNow] = useState(false);
  const season = useSyncExternalStore(
    subscribeNudge,
    () => {
      const now = parseHollowNow(window.location.search, new Date());
      const dismissed = readDismissedNudgeYear(localStorage.getItem(HOLLOW_NUDGE_KEY));
      return shouldShowHollowNudge(now, selection.preset, dismissed);
    },
    () => false,
  );

  if (!season || dismissedNow) return null;

  function dismiss() {
    const now = parseHollowNow(window.location.search, new Date());
    localStorage.setItem(HOLLOW_NUDGE_KEY, String(now.getFullYear()));
    setDismissedNow(true);
  }

  function tryHollow() {
    applyThemeSelection({ mode: selection.mode, preset: HOLLOW_PRESET_ID });
    setDismissedNow(true);
  }

  return (
    <div
      className="hollow-nudge"
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: "var(--bg-elevated)",
        borderBottom: "1px solid var(--border)",
        color: "var(--text)",
        fontFamily: '"American Typewriter", "Courier New", ui-monospace, monospace',
        fontSize: 13,
        letterSpacing: "0.03em",
      }}
    >
      <p style={{ margin: 0, flex: 1 }}>Something&apos;s in the walls. Try the Hollow theme?</p>
      <button type="button" className="btn btn-primary" onClick={tryHollow}>
        Try it
      </button>
      <button type="button" className="btn btn-ghost" onClick={dismiss}>
        Not now
      </button>
    </div>
  );
}
