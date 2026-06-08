import type { CSSProperties } from "react";

/**
 * Shared “signal strip” surface for Today (digest, standup, Datadog, GitHub PRs).
 *
 * **When adding a new strip:** wrap content in `HubSignalStrip` from
 * `components/HubSignalStrip.tsx` instead of copying these styles.
 */
export const hubStripSurfaceStyle: CSSProperties = {
  padding: "8px 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-muted)",
  borderRadius: "var(--radius-sm)",
};

/** Lucide size for strip headers / leading icons (digest metrics, Datadog, GitHub). */
export const HUB_STRIP_ICON_PX = 13;

export const hubStripSetupLinkClassName = "underline underline-offset-2 hover:opacity-90";

export const hubStripSetupLinkStyle: CSSProperties = {
  color: "var(--accent)",
};

/** Inline `gh`, paths, etc. inside strips */
export const hubStripCodeClassName = "rounded bg-[var(--bg-muted)] px-1 font-mono text-[11px]";
