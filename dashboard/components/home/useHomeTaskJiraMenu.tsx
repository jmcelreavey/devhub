"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { JiraTransitionModal } from "@/components/jira/JiraTransitionModal";
import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import { useJiraTicketStatus } from "@/lib/hooks/use-jira-ticket-status";
import { useJiraTransition } from "@/lib/hooks/use-jira-transition";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";

/** Drop-in task menu group with the same one-click transition and Undo as the pill. */
export function useHomeTaskJiraMenu(card: BoardCard, profile?: string) {
  const key = card.jira?.[0];
  const [open, setOpen] = useState(false);
  const move = useJiraTransition();
  const { status, refresh } = useJiraTicketStatus(open ? key : undefined);
  const groups: ContextMenuGroup[] = key ? [{
    id: "home-jira",
    items: [{ id: "update-jira-status", label: "Update Jira status", icon: <RefreshCw size={12} aria-hidden />, onSelect: () => setOpen(true) }],
  }] : [];
  const dialogs = key ? <JiraTransitionModal
    open={open}
    jiraKey={key}
    title="Update Jira status"
    skipLabel="Cancel"
    suggest={status}
    onCancel={() => setOpen(false)}
    onConfirm={(transitionId, to) => {
      setOpen(false);
      if (transitionId) void move(key, { transitionId }, { to, profile, onChanged: () => void refresh() });
    }}
  /> : null;
  return { groups, dialogs };
}
