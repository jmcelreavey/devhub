import type { CSSProperties, ReactNode } from "react";

export type SeverityTone = "critical" | "warning" | "info" | "success" | "muted" | "violet" | "brand";

const TONE_VARS: Record<SeverityTone, { fg: string; bg: string }> = {
  critical: { fg: "var(--danger)",   bg: "var(--danger-dim)" },
  warning:  { fg: "var(--warning)",  bg: "var(--warning-dim)" },
  info:     { fg: "var(--info)",     bg: "var(--info-dim)" },
  success:  { fg: "var(--success)",  bg: "var(--success-dim)" },
  muted:    { fg: "var(--text-subtle)", bg: "var(--bg-elevated)" },
  violet:   { fg: "var(--violet)",   bg: "var(--violet-dim)" },
  brand:    { fg: "var(--accent)",   bg: "var(--accent-dim)" },
};

interface SeverityDotProps {
  tone: SeverityTone;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function SeverityDot({ tone, size = 6, style, className }: SeverityDotProps) {
  const { fg } = TONE_VARS[tone];
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        flexShrink: 0,
        background: fg,
        ...style,
      }}
    />
  );
}

interface SeverityPillProps {
  tone: SeverityTone;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function SeverityPill({ tone, children, style, className }: SeverityPillProps) {
  const { fg, bg } = TONE_VARS[tone];
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.5,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
