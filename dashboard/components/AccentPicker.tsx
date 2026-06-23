"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import {
  THEME_PRESETS,
  applyThemeSelection,
  getThemeSelectionFromDom,
  getServerThemeSelectionSnapshot,
  subscribeThemeSelection,
} from "@/lib/theme-presets";

export function AccentPicker() {
  const selection = useSyncExternalStore(
    subscribeThemeSelection,
    getThemeSelectionFromDom,
    getServerThemeSelectionSnapshot,
  );
  // Display swatches/labels for the currently-applied mode, but preserve the user's mode
  // *setting* (including "system") when they pick a different palette.
  const activeMode = selection.resolvedMode;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function selectPreset(preset: string) {
    applyThemeSelection({ mode: selection.mode, preset });
    setOpen(false);
  }

  return (
    <div ref={ref} className="accent-picker">
      <button
        type="button"
        className="hub-icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Change theme preset"
        aria-label="Change theme preset"
        aria-expanded={open}
      >
        <Palette size={14} aria-hidden />
      </button>
      {open && (
        <div className="accent-picker-pop" role="menu">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="menuitem"
              onClick={() => selectPreset(preset.id)}
              title={`${preset.label} (${activeMode})`}
              aria-label={`Use ${preset.label} theme`}
              style={{
                width: "100%",
                minWidth: "168px",
                display: "flex",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: "10px",
                borderRadius: "8px",
                border:
                  selection.preset === preset.id
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border-muted)",
                background:
                  selection.preset === preset.id
                    ? "var(--accent-dim)"
                    : "var(--bg-surface)",
                cursor: "pointer",
                outline: "none",
                padding: "6px 8px",
                color: "var(--text)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: "1px",
                  minWidth: 0,
                }}
              >
                <span style={{ fontSize: "12px", fontWeight: 600, lineHeight: 1.25 }}>
                  {preset.label}
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--text-subtle)",
                    lineHeight: 1.25,
                  }}
                >
                  {preset.description}
                </span>
              </span>
              <span
                aria-hidden
                style={{
                  width: 52,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    display: "grid",
                    gap: 2,
                    justifyItems: "center",
                  }}
                >
                  <span
                    style={{
                      width: "100%",
                      height: 14,
                      borderRadius: 4,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: preset.darkSwatch,
                      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.35)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 8,
                      lineHeight: 1,
                      color: "var(--text-subtle)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Dark
                  </span>
                </span>
                <span
                  style={{
                    display: "grid",
                    gap: 2,
                    justifyItems: "center",
                  }}
                >
                  <span
                    style={{
                      width: "100%",
                      height: 14,
                      borderRadius: 4,
                      border: "1px solid color-mix(in oklab, var(--border) 85%, #000 15%)",
                      background: preset.lightSwatch,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 8,
                      lineHeight: 1,
                      color: "var(--text-subtle)",
                      letterSpacing: "0.02em",
                    }}
                  >
                    Light
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
