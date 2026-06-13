"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import type { ResponsiveLayouts } from "react-grid-layout";
import {
  TODAY_GRID_DEFAULT_LAYOUTS,
  writeTodayGridLayoutsToStorage,
  readTodayGridLayoutsFromStorage,
  type TodayGridBreakpoint,
} from "@/lib/today-grid-layout";
import { useTodayView, type TodayView } from "@/lib/today-view";

interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  layouts: ResponsiveLayouts<TodayGridBreakpoint>;
}

const CUSTOM_PRESETS_KEY = "devhub-layout-custom-presets";

function readCustomPresets(): LayoutPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LayoutPreset[]) : [];
  } catch {
    return [];
  }
}

function writeCustomPresets(presets: LayoutPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch { /* quota / private */ }
}

function applyPreset(layouts: ResponsiveLayouts<TodayGridBreakpoint>) {
  writeTodayGridLayoutsToStorage(layouts);
  window.dispatchEvent(new CustomEvent("devhub:grid-preset-apply"));
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LayoutPresetsButton() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useTodayView();
  const [customPresets, setCustomPresets] = useState<LayoutPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading synchronously from localStorage when dropdown opens
  useEffect(() => { setCustomPresets(readCustomPresets()); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  const handleApply = useCallback((preset: LayoutPreset) => {
    applyPreset(preset.layouts);
    setOpen(false);
  }, []);

  const handleReset = useCallback(() => {
    applyPreset(TODAY_GRID_DEFAULT_LAYOUTS);
    setOpen(false);
  }, []);

  const handleSaveCustom = useCallback(() => {
    const name = saveName.trim() || "Custom";
    const current = readTodayGridLayoutsFromStorage();
    if (!current) return;
    const preset: LayoutPreset = {
      id: `custom-${Date.now()}`,
      name,
      description: "Saved layout",
      layouts: current,
    };
    const next = [...readCustomPresets(), preset];
    writeCustomPresets(next);
    setCustomPresets(next);
    setSaving(false);
    setSaveName("");
  }, [saveName]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-elevated)]"
        style={{ color: "var(--text-subtle)" }}
        title="Layout presets"
        aria-label="Layout presets"
        aria-expanded={open}
      >
        <LayoutGrid size={12} aria-hidden />
        Layout
      </button>

      {open && (
        <div
          className="absolute z-50 rounded-lg shadow-lg overflow-hidden"
          style={{
            right: 0,
            top: "calc(100% + 4px)",
            minWidth: 220,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-muted)",
          }}
        >
          {/* View mode — Calm Focus (design B) vs dashboard grid (A+B) */}
          <div style={{ padding: "4px 0", borderBottom: "1px solid var(--border-muted)" }}>
            <div
              className="px-3 pb-1 pt-1.5 text-[10.5px] font-bold uppercase"
              style={{ color: "var(--text-subtle)", letterSpacing: ".08em" }}
            >
              View
            </div>
            {(
              [
                ["focus", "Focus", "One thing now — the rest whispers"],
                ["dashboard", "Dashboard", "Draggable grid with all the cards"],
              ] as [TodayView, string, string][]
            ).map(([id, name, desc]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setView(id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-muted)]"
                aria-pressed={view === id}
              >
                <span
                  className="text-[13px]"
                  style={{ color: view === id ? "var(--accent)" : "var(--text)" }}
                >
                  {name}
                </span>
                <span className="text-[11px] truncate" style={{ color: "var(--text-subtle)" }}>
                  {desc}
                </span>
              </button>
            ))}
          </div>

          {/* Custom presets */}
          {customPresets.length > 0 && (
            <div style={{ padding: "4px 0" }}>
              {customPresets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleApply(p)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-muted)]"
                >
                  <span className="text-[13px]" style={{ color: "var(--text)" }}>{p.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ borderTop: "1px solid var(--border-muted)", padding: "4px 0" }}>
            {saving ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  className="input text-[12px] flex-1 min-w-0"
                  placeholder="Preset name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveCustom();
                    if (e.key === "Escape") { setSaving(false); setSaveName(""); }
                  }}
                  autoFocus
                />
                <button type="button" className="btn btn-ghost text-[12px] px-2 py-1" onClick={handleSaveCustom}>
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors hover:bg-[var(--bg-muted)]"
                style={{ color: "var(--text-muted)" }}
              >
                Save current as preset…
              </button>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors hover:bg-[var(--bg-muted)]"
              style={{ color: "var(--text-subtle)" }}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
