"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { parseMarkdownLinks, stripTagTokens } from "@/lib/tasks/task-text";

/**
 * Task title: markdown links stay live. `#tag` tokens are not a feature
 * anymore, so they are dropped. A title that is nothing but tags keeps them
 * — an empty row would be worse.
 */
export function TaskTextContent({ text }: { text: string }) {
  return <>{renderTaskTextNodes(text)}</>;
}

function renderTaskTextNodes(text: string): ReactNode {
  const parts = parseMarkdownLinks(text);
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === "text")) {
    return stripTagTokens(text);
  }
  return parts.map((part, i) => {
    if (part.type === "link" && part.url) {
      const internal = part.url.startsWith("/");
      return internal ? (
        <Link
          key={i}
          href={part.url}
          onClick={(e) => e.stopPropagation()}
          className="text-accent underline underline-offset-2"
        >
          {part.text}
        </Link>
      ) : (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-accent underline underline-offset-2"
        >
          {part.text}
        </a>
      );
    }
    return <span key={i}>{stripTagTokens(part.text)}</span>;
  });
}
