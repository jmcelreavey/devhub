"use client";
import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { preload } from "swr";
import { SeverityPill } from "@/components/ui/Severity";
import { statusTone } from "@/components/jira/JiraWidget";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import { HoverTip } from "@/components/ui/HoverTip";
import { defaultFetcher } from "@/lib/hooks/use-fetch";
import { useJiraTransition } from "@/lib/hooks/use-jira-transition";
import { useTransitionOverride } from "@/lib/jira/transition-state";

interface JiraStatusPillProps {
  ticketKey: string;
  status: string;
  onChanged?: () => void;
  profile?: string;
}

export function JiraStatusPill({ ticketKey, status, onChanged, profile }: JiraStatusPillProps) {
  const [open, setOpen] = useState(false);
  const move = useJiraTransition();
  const override = useTransitionOverride(ticketKey);
  const shown = override?.status ?? status;
  const pending = override?.pending === true;

  const handleConfirm = useCallback((transitionId: string | null, to?: string) => {
    setOpen(false);
    if (!transitionId) return;
    void move(ticketKey, { transitionId }, { to, onChanged, profile });
  }, [ticketKey, move, onChanged, profile]);

  // The picker needs the transition list; start fetching it before the click lands.
  const warm = () => void preload(`/api/jira/ticket/${ticketKey}/transitions`, defaultFetcher).catch(() => undefined);

  return (
    <>
      <HoverTip label="Change Jira status" pos="top-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          onMouseEnter={warm}
          onFocus={warm}
          disabled={pending}
          aria-busy={pending}
          aria-label={pending ? `${ticketKey} moving to ${shown}` : `Change status from ${shown}`}
          style={{ border: "none", background: "none", padding: 0, cursor: pending ? "progress" : "pointer", borderRadius: 999 }}
        >
          <SeverityPill tone={statusTone(shown)}>
            {pending && <Loader2 size={10} className="animate-spin" aria-hidden />}
            {shown}
          </SeverityPill>
        </button>
      </HoverTip>
      <JiraTransitionModal
        open={open}
        jiraKey={ticketKey}
        title="Update Jira status"
        skipLabel="Cancel"
        suggest={status}
        onCancel={() => setOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
}
