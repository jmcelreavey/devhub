"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";

export interface CliCommand {
  command: string;
  label: string;
}

interface CliEquivalentsProps {
  commands: CliCommand[];
  prereqs?: string[];
}

export function CliEquivalents({ commands, prereqs }: CliEquivalentsProps) {
  const [open, setOpen] = useState(false);

  if (commands.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs w-full text-left"
        style={{
          color: "var(--text-subtle)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          font: "inherit",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ fontWeight: 500 }}>CLI equivalents</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-4">
          {prereqs && prereqs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>Requires:</span>
              {prereqs.map((p) => (
                <code
                  key={p}
                  className="font-mono"
                  style={{
                    background: "var(--bg)",
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontSize: 11,
                  }}
                >
                  {p}
                </code>
              ))}
            </div>
          )}

          {commands.map((cmd, i) => (
            <div key={i} className="space-y-0.5">
              <div className="text-xs" style={{ color: "var(--text-muted)", paddingLeft: 2 }}>
                {cmd.label}
              </div>
              <div className="flex items-center gap-2">
                <code
                  className="text-xs flex-1 font-mono"
                  style={{
                    background: "var(--bg)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    color: "var(--text-subtle)",
                    wordBreak: "break-all",
                    whiteSpace: "normal",
                  }}
                >
                  {cmd.command}
                </code>
                <CopyButton text={cmd.command} label="command" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
