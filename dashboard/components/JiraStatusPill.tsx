"use client";

import { useState, useCallback } from "react";
import { SeverityPill } from "@/components/ui/Severity";
import { statusTone } from "@/components/JiraWidget";
import { JiraTransitionModal } from "@/components/JiraTransitionModal";
import { useToast } from "@/lib/use-toast";
import { mutate } from "swr";

interface JiraStatusPillProps {
  ticketKey: string;
  status: string;
  onChanged?: () => void;
}

export function JiraStatusPill({ ticketKey, status, onChanged }: JiraStatusPillProps) {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  const handleConfirm = useCallback(async (transitionId: string | null) => {
    setOpen(false);
    if (!transitionId) return;
    try {
      const res = await fetch(`/api/jira/ticket/${ticketKey}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitionId }),
      });
      if (!res.ok) throw new Error("Transition failed");
      toast.success(`Updated ${ticketKey}`);
      void mutate("/api/jira/tickets");
      void mutate("/api/sidebar/counts");
      onChanged?.();
    } catch {
      toast.error(`Couldn't transition ${ticketKey}`);
    }
  }, [ticketKey, toast, onChanged]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change status from ${status}`}
        data-tooltip="Change Jira status"
        data-tooltip-pos="top-end"
        style={{ border: "none", background: "none", padding: 0, cursor: "pointer", borderRadius: 999 }}
      >
        <SeverityPill tone={statusTone(status)}>{status}</SeverityPill>
      </button>
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
