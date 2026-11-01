"use client";

import type { ReactNode } from "react";
import { DocMermaid } from "@/components/docs/DocMermaid";
import { safeLinkHref } from "@shared/task-note/meta.ts";
import styles from "./TaskDetailPanel.module.css";

/** `code`, **bold**, *italic* and [text](url). Anything else stays text; React escapes it. */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    const href = link ? safeLinkHref(link[2]!) : undefined;
    if (link && href) return <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}

type Block =
  | { kind: "heading"; level: 3 | 4; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "paragraph"; text: string };

/** Review notes are agent-written markdown; the structural subset is enough to make them scannable. */
export function parseReviewMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      while (++index < lines.length && !lines[index]!.startsWith("```")) body.push(lines[index]!);
      blocks.push({ kind: "code", lang: fence[1]!, text: body.join("\n") });
      continue;
    }
    // Directive lines such as `::task-ref …` are plumbing, not prose.
    if (!line.trim() || line.startsWith("::")) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1]!.length <= 2 ? 3 : 4, text: heading[2]! }); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const last = blocks.at(-1);
      const text = line.replace(/^\s*[-*]\s+/, "");
      if (last?.kind === "list") last.items.push(text); else blocks.push({ kind: "list", items: [text] });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === "paragraph" && lines[index - 1]?.trim()) last.text += ` ${line.trim()}`; else blocks.push({ kind: "paragraph", text: line.trim() });
  }
  return blocks;
}

export function ReviewMarkdown({ markdown }: { markdown: string }) {
  return <div className={styles.markdown}>{parseReviewMarkdown(markdown).map((block, index) => {
    switch (block.kind) {
      case "heading": return block.level === 3 ? <h4 key={index}>{inline(block.text)}</h4> : <h5 key={index}>{inline(block.text)}</h5>;
      case "list": return <ul key={index} className={styles.list}>{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
      case "code": return block.lang.toLowerCase() === "mermaid" ? <DocMermaid key={index} code={block.text} /> : <pre key={index} data-lang={block.lang || undefined}><code>{block.text}</code></pre>;
      default: return <p key={index}>{inline(block.text)}</p>;
    }
  })}</div>;
}
