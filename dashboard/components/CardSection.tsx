"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info, X } from "lucide-react";
import { CliEquivalents } from "@/components/CliEquivalents";

// ---------------------------------------------------------------------------
// Help modal (optional per-section documentation overlay)
// ---------------------------------------------------------------------------

export interface SectionHelpData {
  description: string;
  details?: string[];
  commands?: Array<{ cmd: string; note: string }>;
}

function SectionHelpModal({
  title,
  help,
  onClose,
}: {
  title: string;
  help: SectionHelpData;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          padding: 20,
          maxWidth: 600,
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </span>
          <button type="button" className="btn btn-ghost" style={{ padding: 4 }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          {help.description}
        </p>
        {help.details && (
          <ul
            className="text-xs mb-3 space-y-1.5"
            style={{ color: "var(--text-muted)", paddingLeft: 16 }}
          >
            {help.details.map((d, i) => (
              <li key={i} style={{ listStyle: "disc", wordBreak: "break-word" }}>
                {d}
              </li>
            ))}
          </ul>
        )}
        {help.commands && (
          <CliEquivalents
            commands={help.commands.map((c) => ({ command: c.cmd, label: c.note }))}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardSection — collapsible card using standard .card / .card-header classes
// ---------------------------------------------------------------------------

/**
 * Reusable collapsible section that uses the standard `.card`, `.card-header`,
 * and `.card-body` CSS classes instead of duplicating them as inline styles.
 *
 * Props:
 * - `title` — uppercase header label
 * - `icon` — leading icon node
 * - `rightElement` — optional status badge / action on the right side of the header
 * - `help` — optional help data to show an info button + modal
 * - `defaultOpen` — initial collapse state (default `true`)
 * - `noPadding` — skip card-body padding (useful for list/table content)
 */
export function CardSection({
  title,
  icon,
  rightElement,
  help,
  defaultOpen = true,
  noPadding = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  rightElement?: React.ReactNode;
  help?: SectionHelpData;
  defaultOpen?: boolean;
  noPadding?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="card">
      <div className="card-header">
        <button
          type="button"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "inherit",
            font: "inherit",
          }}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          {title}
        </button>
        <span className="flex items-center gap-2">
          {rightElement}
          {help && (
            <button
              type="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setShowHelp(true);
              }}
              className="btn btn-ghost"
              style={{ padding: "4px 6px", color: "var(--text-subtle)", display: "flex" }}
              title={`About ${title}`}
            >
              <Info size={14} />
            </button>
          )}
        </span>
      </div>
      {open && <div className={noPadding ? "" : "card-body"}>{children}</div>}
      {showHelp && help && (
        <SectionHelpModal title={title} help={help} onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}
