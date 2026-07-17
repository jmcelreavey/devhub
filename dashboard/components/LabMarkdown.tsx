"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cursorRepoFileUrl, looksLikeRepoFile } from "@/lib/cursor-link";

/** Inline formatting: **bold**, *italic* / _italic_, `code`. */
function renderInline(text: string, fileBase?: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;
  while (remaining) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`([^`]+?)`/);
    // Single-asterisk / underscore italics — must not sit inside a ** pair.
    const italicMatch = remaining.match(/(?<![*\w])[*_]([^*_]+?)[*_](?![*\w])/);
    let match: RegExpMatchArray | null = null;
    for (const m of [boldMatch, codeMatch, italicMatch]) {
      if (m && (!match || (m.index ?? 0) < (match.index ?? 0))) match = m;
    }
    if (!match) {
      parts.push(remaining);
      break;
    }
    if ((match.index ?? 0) > 0) parts.push(remaining.slice(0, match.index));
    if (match === boldMatch) {
      parts.push(
        <strong key={key++} style={{ color: "var(--text)" }}>
          {match[1]}
        </strong>,
      );
    } else if (match === codeMatch) {
      const token = match[1];
      const code = (
        <code
          key={key++}
          className="text-[11px] px-1 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--accent)" }}
        >
          {token}
        </code>
      );
      // File-path-looking tokens become "open in Cursor" deep links.
      if (fileBase && looksLikeRepoFile(token)) {
        parts.push(
          <a
            key={key++}
            href={cursorRepoFileUrl(fileBase, token)}
            title={`Open ${token} in Cursor`}
            className="lab-evidence-link"
            style={{ textDecoration: "none" }}
          >
            {code}
          </a>,
        );
      } else {
        parts.push(code);
      }
    } else {
      parts.push(<em key={key++}>{match[1]}</em>);
    }
    remaining = remaining.slice((match.index ?? 0) + match[0].length);
  }
  return parts;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable */
    }
  }
  return (
    <div className="my-2 rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div
        className="flex items-center justify-between px-2 py-0.5"
        style={{ background: "var(--bg-muted)" }}
      >
        <span className="text-[10px] font-medium tracking-tight" style={{ color: "var(--text-subtle)" }}>
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1 text-[10px] lab-evidence-link"
          style={{ color: copied ? "var(--accent)" : "var(--text-subtle)" }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className="overflow-x-auto p-2 text-[11px] leading-relaxed"
        style={{ background: "var(--bg-elevated)", color: "var(--text)", margin: 0 }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Markdown renderer for lab content, tutor messages, learnings, and read-only snippets.
 * Canonical markdown view — SimpleMarkdown is a thin wrapper around this.
 *
 * @param fileBase When set (a repo or workspace absolute path), backticked
 * tokens that look like relative file paths become Cursor deep links.
 * @param compact Tighter headings / spacing for previews.
 */
export function LabMarkdown({
  text,
  fileBase,
  compact = false,
}: {
  text: string;
  fileBase?: string;
  compact?: boolean;
}) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(<CodeBlock key={key++} code={body.join("\n")} lang={lang} />);
      continue;
    }

    if (line.startsWith("### ")) {
      out.push(
        <h3
          key={key++}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-xs font-semibold mt-3 mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(4), fileBase)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      out.push(
        <h2
          key={key++}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-sm font-semibold mt-4 mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(3), fileBase)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      out.push(
        <h1
          key={key++}
          className={compact ? "text-xs font-semibold mb-0.5" : "text-[15px] font-bold mt-2 mb-1"}
          style={{ color: "var(--text)" }}
        >
          {renderInline(line.slice(2), fileBase)}
        </h1>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      out.push(
        <div key={key++} className="text-xs leading-relaxed pl-3" style={{ color: "var(--text-muted)" }}>
          • {renderInline(line.replace(/^\s*[-*]\s+/, ""), fileBase)}
        </div>,
      );
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const m = line.match(/^\s*(\d+)\.\s+(.*)$/)!;
      out.push(
        <div key={key++} className="text-xs leading-relaxed pl-3" style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--text-subtle)" }}>{m[1]}.</span> {renderInline(m[2], fileBase)}
        </div>,
      );
    } else if (line.trim() === "") {
      if (!compact) out.push(<div key={key++} className="h-1.5" />);
    } else if (/^---+$/.test(line.trim())) {
      out.push(<hr key={key++} className="my-2" style={{ borderColor: "var(--border)" }} />);
    } else {
      out.push(
        <div key={key++} className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {renderInline(line, fileBase)}
        </div>,
      );
    }
    i++;
  }

  return <div>{out}</div>;
}
