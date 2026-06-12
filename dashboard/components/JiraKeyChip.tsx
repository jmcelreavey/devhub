"use client";

import { copyWithToast } from "@/lib/pr-slack";
import { useToast } from "@/lib/use-toast";

interface JiraKeyChipProps {
  jiraKey: string;
  /** Dim + strike when the owning task is done. */
  done?: boolean;
}

/**
 * Mono Jira-key chip — click to copy the key (same toast pattern as the
 * PR Slack-copy buttons). Shared by the task list and ticket strips.
 */
export function JiraKeyChip({ jiraKey, done = false }: JiraKeyChipProps) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={copyWithToast(jiraKey, jiraKey, toast)}
      className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs"
      title={`Copy ${jiraKey}`}
      style={{
        background: "var(--accent-dim)",
        color: "var(--accent)",
        border: "none",
        textDecoration: done ? "line-through" : "none",
        opacity: done ? 0.5 : 1,
      }}
    >
      {jiraKey}
    </button>
  );
}
