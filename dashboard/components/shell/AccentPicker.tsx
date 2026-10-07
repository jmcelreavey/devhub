"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/shell/ThemeToggle";
import { Monitor, Moon, Palette, Sun, type LucideIcon } from "lucide-react";
import {
  THEME_PRESETS,
  type ThemeModeSetting,
  applyThemeSelection,
} from "@/lib/theme-presets";

const MODES: { id: ThemeModeSetting; label: string; Icon: LucideIcon }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

/**
 * The one appearance control: light/dark/system mode plus palette preset.
 * Mode used to be a separate top-bar button that cycled blind through three
 * states; side by side with the palettes it needs no guessing.
 */
export function AccentPicker() {
  const selection = useTheme();
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
        title="Appearance"
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette size={14} aria-hidden />
      </button>
      {open && (
        <div className="accent-picker-pop" role="menu" aria-label="Appearance">
          <div role="group" aria-label="Mode" className="accent-picker-modes">
            {MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={selection.mode === id}
                data-active={selection.mode === id || undefined}
                className="accent-picker-mode"
                onClick={() => applyThemeSelection({ mode: id, preset: selection.preset })}
              >
                <Icon size={12} aria-hidden />
                {label}
              </button>
            ))}
          </div>
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
                  {/* Background with a slab of the accent. Background alone is a
                      near-black rectangle for every dark theme, so the chips were
                      indistinguishable — the accent is what identifies a palette. */}
                  <span
                    style={{
                      width: "100%",
                      height: 14,
                      borderRadius: 4,
                      border: "1px solid color-mix(in oklab, #fff 15%, transparent)",
                      background: preset.darkAccent
                        ? `linear-gradient(90deg, ${preset.darkSwatch} 0 55%, ${preset.darkAccent} 55% 100%)`
                        : preset.darkSwatch,
                      boxShadow: "var(--shadow-inset)",
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
                      background: preset.lightAccent
                        ? `linear-gradient(90deg, ${preset.lightSwatch} 0 55%, ${preset.lightAccent} 55% 100%)`
                        : preset.lightSwatch,
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
