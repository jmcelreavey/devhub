"use client";

import { Loader2 } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { useLive } from "@/lib/use-fetch";

interface Transition {
  id: string;
  name: string;
  to: string;
}

export interface JiraTransitionModalProps {
  open: boolean;
  jiraKey: string;
  title: string;
  /** Text on the button that proceeds without changing Jira state. */
  skipLabel?: string;
  /** Transition name to pre-highlight (e.g. "Done" on complete, "Won't Do" on abandon). */
  suggest?: string;
  onCancel: () => void;
  /** transitionId is null when the user chooses to skip the Jira state change. */
  onConfirm: (transitionId: string | null) => void;
}

export function JiraTransitionModal({
  open,
  jiraKey,
  title,
  skipLabel = "Skip — leave Jira as-is",
  suggest,
  onCancel,
  onConfirm,
}: JiraTransitionModalProps) {
  const { data, isLoading: loading } = useLive<{ transitions?: Transition[] }>(
    open ? `/api/jira/ticket/${jiraKey}/transitions` : null,
    { refreshInterval: 0 },
  );
  const transitions = data?.transitions ?? null;

  const suggestLc = suggest?.toLowerCase();

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      dismissOnBackdrop={false}
      title={title}
      description={`Move ${jiraKey} to a new state, or skip.`}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onConfirm(null)}>
            {skipLabel}
          </button>
        </div>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 py-4 text-sm" style={{ color: "var(--text-subtle)" }}>
          <Loader2 size={14} className="animate-spin" /> Loading states…
        </div>
      )}

      {!loading && (transitions?.length ?? 0) === 0 && (
        <p className="py-3 text-sm" style={{ color: "var(--text-subtle)" }}>
          No transitions available for this ticket.
        </p>
      )}

      {!loading && transitions && transitions.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {transitions.map((t) => {
            const highlight = suggestLc && (t.to.toLowerCase() === suggestLc || t.name.toLowerCase() === suggestLc);
            return (
              <button
                key={t.id}
                type="button"
                className="truncate rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors"
                title={t.name !== t.to ? `${t.to} (${t.name})` : t.to}
                onClick={() => onConfirm(t.id)}
                style={{
                  border: `1px solid ${highlight ? "var(--accent)" : "var(--border-muted)"}`,
                  background: highlight ? "var(--accent-dim)" : "transparent",
                  color: "var(--text)",
                }}
              >
                {t.to}
              </button>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
