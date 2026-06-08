"use client";

import { HoverTip } from "@/components/HoverTip";

/**
 * A row of small toggle buttons — one active at a time.
 *
 * Replaces the 4+ hand-rolled inline-styled button groups on the ops page
 * (env selectors, cluster selectors) and can be reused anywhere a compact
 * segmented-control-style picker is needed.
 *
 * Supports optional per-option colour via `activeColor` / `activeBg` on items,
 * falling back to the accent colour.
 */

export interface ToggleOption<T extends string> {
  value: T;
  label?: string;
  /** Active border + text colour override (CSS value). */
  activeColor?: string;
  /** Active background override (CSS value). */
  activeBg?: string;
  /** Always-visible identity dot colour (separate from selection state). */
  dotColor?: string;
  /** When true the button is visible but non-interactive and dimmed. */
  disabled?: boolean;
  /** Tooltip shown on hover when disabled. */
  disabledReason?: string;
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  "aria-label": ariaLabel,
}: {
  options: readonly ToggleOption<T>[] | readonly T[];
  value: T;
  onChange: (v: T) => void;
  /** `sm` = compact (ops-style), `md` = default btn sizing */
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  const padding = size === "sm" ? "4px 10px" : "5px 12px";

  const normalised: ToggleOption<T>[] = (options as readonly (T | ToggleOption<T>)[]).map((o) =>
    typeof o === "string" ? { value: o as T } : (o as ToggleOption<T>),
  );

  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-1">
      {normalised.map((opt) => {
        const active = value === opt.value;
        const hasDot = Boolean(opt.dotColor);
        const color = opt.activeColor ?? (hasDot ? "var(--text)" : "var(--accent)");
        const bg = opt.activeBg ?? (hasDot ? "var(--bg-elevated)" : "var(--accent-dim)");
        return (
          <HoverTip
            key={opt.value}
            label={opt.disabled ? (opt.disabledReason ?? "No access") : undefined}
            pos="top"
          >
            <button
              type="button"
              className="btn text-xs"
              style={{
                padding,
                background: active && !opt.disabled ? bg : "var(--bg)",
                borderColor: active && !opt.disabled ? color : "var(--border)",
                color: opt.disabled ? "var(--text-subtle)" : active ? color : "var(--text-muted)",
                opacity: opt.disabled ? 0.5 : 1,
                cursor: opt.disabled ? "not-allowed" : undefined,
              }}
              onClick={() => !opt.disabled && onChange(opt.value)}
              disabled={opt.disabled}
            >
              {opt.dotColor && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: opt.dotColor, opacity: opt.disabled ? 0.4 : 1 }}
                  aria-hidden
                />
              )}
              {opt.label ?? opt.value}
            </button>
          </HoverTip>
        );
      })}
    </div>
  );
}
