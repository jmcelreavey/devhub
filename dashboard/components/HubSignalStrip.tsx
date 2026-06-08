"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { hubStripSurfaceStyle } from "@/lib/hub-strip";

export interface HubSignalStripProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  children: ReactNode;
  /** Outer spacing — default matches other Today strips. */
  className?: string;
  /** `danger` for load errors; default is body copy on `var(--text-muted)`. */
  tone?: "default" | "danger";
}

/**
 * Today / hub “signal” row: digest, standup, Datadog, GitHub PRs.
 * DRY surface; pass `className` for `mb-0` on Status, etc.
 */
export function HubSignalStrip({
  children,
  className = "mb-3",
  tone = "default",
  style,
  ...rest
}: HubSignalStripProps) {
  const merged: CSSProperties = {
    ...hubStripSurfaceStyle,
    color: tone === "danger" ? "var(--danger)" : "var(--text-muted)",
    ...style,
  };
  return (
    <div className={`min-w-0 text-xs ${className}`.trim()} style={merged} {...rest}>
      {children}
    </div>
  );
}

/** Section title inside a strip (GitHub PRs, optional reuse). */
/** Monospace snippets (`gh`, paths) inside hub strips — keep in TSX so Tailwind sees classes. */
export const hubStripInlineCodeClassName =
  "rounded bg-[var(--bg-muted)] px-1 font-mono text-[11px] tabular-nums";

export function HubStripHeading({
  icon,
  children,
  className = "mb-1",
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 font-medium ${className}`.trim()} style={{ color: "var(--text)" }}>
      {icon}
      {children}
    </div>
  );
}
