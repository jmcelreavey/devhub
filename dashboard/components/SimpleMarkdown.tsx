import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    let match = boldMatch || italicMatch || codeMatch;
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (boldMatch && (!match || (boldMatch.index ?? 0) <= (match.index ?? 0))) match = boldMatch;
    if (italicMatch && (!match || (italicMatch.index ?? 0) < (match.index ?? 0))) match = italicMatch;
    if (codeMatch && (!match || (codeMatch.index ?? 0) < (match.index ?? 0))) match = codeMatch;
    if ((match.index ?? 0) > 0) parts.push(remaining.slice(0, match.index));
    if (match === boldMatch) parts.push(<strong key={key++} style={{ color: "var(--text)" }}>{match[1]}</strong>);
    else if (match === italicMatch) parts.push(<em key={key++}>{match[1]}</em>);
    else if (match === codeMatch) {
      parts.push(
        <code key={key++} className="text-[11px] px-1 rounded" style={{ background: "var(--bg-elevated)", color: "var(--accent)" }}>
          {match[1]}
        </code>,
      );
    }
    remaining = remaining.slice((match.index ?? 0) + match[0].length);
  }
  return parts;
}

export interface SimpleMarkdownProps {
  text: string;
  compact?: boolean;
  className?: string;
}

/** Lightweight markdown for learnings previews and read-only snippets. */
export function SimpleMarkdown({ text, compact = false, className }: SimpleMarkdownProps) {
  const lines = text.split("\n").map((line, i) => {
    if (line.startsWith("### ")) {
      return (
        <h3
          key={i}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-sm font-semibold mt-3 mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(4))}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2
          key={i}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-[15px] font-semibold mt-4 mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(3))}
        </h2>
      );
    }
    if (line.startsWith("# ")) {
      return (
        <h1
          key={i}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-[17px] font-bold mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(2))}
        </h1>
      );
    }
    if (line.startsWith("- ")) {
      return (
        <div key={i} className="text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
          {renderInline(line.slice(2))}
        </div>
      );
    }
    if (line.trim() === "") return compact ? null : <div key={i} className="h-1.5" />;
    return (
      <div key={i} className="text-xs leading-relaxed" style={{ color: "var(--text-subtle)" }}>
        {renderInline(line)}
      </div>
    );
  });

  return <div className={className}>{lines}</div>;
}
