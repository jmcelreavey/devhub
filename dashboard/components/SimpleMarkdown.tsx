import type { ReactNode } from "react";
import { LabMarkdown } from "@/components/LabMarkdown";

export interface SimpleMarkdownProps {
  text: string;
  compact?: boolean;
  className?: string;
}

/**
 * Lightweight markdown for learnings / read-only snippets.
 * Delegates to LabMarkdown (canonical renderer) — one markdown story.
 */
export function SimpleMarkdown({ text, compact = false, className }: SimpleMarkdownProps): ReactNode {
  return (
    <div className={className} data-md-compact={compact ? "1" : undefined}>
      <LabMarkdown text={text} compact={compact} />
    </div>
  );
}
