import type { CSSProperties, ReactNode } from "react";
import { SeverityDot, type SeverityTone } from "./Severity";

export type QueueRowSize = "compact" | "comfortable" | "dense";

interface QueueRowChiplet {
  label: string;
  mono?: boolean;
}

interface QueueRowProps {
  /** Coloured dot at the left edge (omit to hide) */
  tone?: SeverityTone;
  /** Monospace key e.g. "PTF-3469" */
  monoKey?: string;
  /** Main title */
  title: string;
  /** Small chips below the title (repo, context) */
  chiplets?: QueueRowChiplet[];
  /** Status pill text */
  statusLabel?: string;
  /** Pre-rendered status pill — takes precedence over statusLabel */
  statusPill?: ReactNode;
  /** Right-most meta e.g. date */
  age?: string;
  /** Hover-shelf actions (copy buttons, links) */
  actions?: ReactNode;
  /** Row density */
  size?: QueueRowSize;
  /** Native link href */
  href?: string;
  style?: CSSProperties;
  className?: string;
}

const PAD: Record<QueueRowSize, string> = {
  compact: "5px 10px",
  comfortable: "8px 14px",
  dense: "3px 8px",
};

export function QueueRow({
  tone,
  monoKey,
  title,
  chiplets,
  statusLabel,
  statusPill,
  age,
  actions,
  size = "comfortable",
  href,
  style,
  className,
}: QueueRowProps) {
  const pad = PAD[size];

  return (
    <div
      className={["group relative flex min-w-0 items-start gap-2", className].filter(Boolean).join(" ")}
      style={{ padding: pad, ...style }}
    >
      {/* State dot */}
      {tone && (
        <span className="mt-[5px] shrink-0">
          <SeverityDot tone={tone} size={5} />
        </span>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {monoKey && (
            <span
              className="shrink-0 font-mono text-[11px]"
              style={{ color: "var(--text-subtle)" }}
            >
              {monoKey}
            </span>
          )}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-[13px] font-medium no-underline hover:underline"
              style={{ color: "var(--text)" }}
            >
              {title}
            </a>
          ) : (
            <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: "var(--text)" }}>
              {title}
            </span>
          )}
          <span className="flex-1" />
          {statusPill ?? (statusLabel && (
            <span
              className="shrink-0 font-mono text-[11px]"
              style={{ color: "var(--text-subtle)" }}
            >
              {statusLabel}
            </span>
          ))}
          {age && (
            <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--text-subtle)" }}>
              {age}
            </span>
          )}
        </div>

        {chiplets && chiplets.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {chiplets.map((c) => (
              <span
                key={c.label}
                className={`rounded px-1.5 py-0 text-[10.5px] ${c.mono ? "font-mono" : ""}`}
                style={{
                  background: "var(--bg)",
                  color: "var(--text-subtle)",
                  border: "1px solid var(--border-muted)",
                }}
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hover-shelf actions */}
      {actions && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
