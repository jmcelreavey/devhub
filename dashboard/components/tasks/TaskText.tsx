import Link from "next/link";
import type { ReactNode } from "react";
import { parseMarkdownLinks } from "@/lib/tasks/task-text";

/**
 * Render task text with its markdown links live.
 *
 * The rendering half of the extraction; the parsing half is pure and lives in
 * `lib/tasks/task-text.ts` so it can be tested without React.
 */
export function renderTaskTextContent(text: string): ReactNode {
  const parts = parseMarkdownLinks(text);
  if (parts.length === 0 || (parts.length === 1 && parts[0].type === "text")) {
    return text;
  }
  return parts.map((part, i) => {
    if (part.type === "link" && part.url) {
      // In-app links (e.g. a lab's Learnings note) navigate like every other
      // internal link; only external URLs get a new tab.
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
    return <span key={i}>{part.text}</span>;
  });
}
