"use client";

import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { BoardCard } from "../../../../packages/shared/ui-lib/storyboard/notes-board-shared";
import { useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { RuntimeSlotView, useRuntimeSlots } from "@/components/plugins/RuntimeSlots";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";
import { z } from "zod";
import { useLive } from "@/lib/hooks/use-fetch";
import { useToast } from "@/lib/hooks/use-toast";
import { buildTaskReviewMessage, copyTextAndToast } from "@/lib/pr-slack";

const collaborationSchema = z.object({ linked: z.literal(true), online: z.literal(true), members: z.array(z.object({ userId: z.string(), userName: z.string() })).min(1) });

function isCollaborationSlot(entry: { plugin: string; id: string }): boolean {
  return entry.plugin === "team" && (entry.id === "team-ask" || entry.id === "team-handoff");
}

export function useTaskPluginActions(card: BoardCard, profile?: string) {
  const catalog = useRuntimeSlots("task");
  const collaboration = useLive<unknown>(catalog.slots.some(isCollaborationSlot) ? "/api/team/collaboration" : null, { refreshInterval: 30_000 });
  const canCollaborate = !catalog.error && !catalog.invalid && !collaboration.error && collaborationSchema.safeParse(collaboration.data).success;
  const [selected, setSelected] = useState<string | null>(null);
  const available = !!profile && !!card.task?.createdAt && !isTaskOwnershipBlocked(card.task) && !card.taskDone && !card.task?.abandonedAt && !card.task?.endDate;
  const slots = available ? catalog.slots.filter((slot) => !isCollaborationSlot(slot) || canCollaborate) : [];
  const entry = slots.find((entry) => `${entry.plugin}/${entry.id}` === selected);
  const open = (id: string) => setSelected(id);
  const groups: ContextMenuGroup[] = slots.length ? [{ id: "plugins", label: "Plugins", items: slots.map((entry) => ({ id: `${entry.plugin}/${entry.id}`, label: entry.label, onSelect: () => open(`${entry.plugin}/${entry.id}`) })) }] : [];
  return {
    visible: slots.length > 0,
    canCollaborate: available && canCollaborate,
    groups,
    error: catalog.error || catalog.invalid,
    retry: () => void catalog.mutate(),
    dialogs: entry && profile && card.task ? <ModalShell open onClose={() => setSelected(null)} title={entry.label} maxWidth="max-w-3xl">
      <RuntimeSlotView key={`${entry.plugin}/${entry.id}/${entry.revision}/${card.taskId}/${profile}`} entry={entry} context={{ location: "task", taskId: card.taskId, createdAt: card.task.createdAt, profile }} onClose={() => setSelected(null)} />
    </ModalShell> : null,
    open,
  };
}

export function TaskPluginButtons(props: { card: BoardCard; profile?: string }) {
  const actions = useTaskPluginActions(props.card, props.profile);
  const toast = useToast();
  const copyReview = props.card.status === "ready-for-review" && !actions.canCollaborate;
  if (!actions.visible && !actions.error && !copyReview) return null;
  return <>
    {actions.error ? <p role="status" className="text-xs text-text-muted">Plugin actions unavailable. <button type="button" className="btn btn-ghost" onClick={actions.retry}>Retry</button></p> : null}
    <div className="flex flex-wrap gap-1">
      {actions.groups.flatMap((group) => group.items.map((item) => <button type="button" className="btn btn-ghost text-xs" key={item.id} onClick={() => actions.open(item.id)}>{item.label}</button>))}
      {copyReview ? <button type="button" className="btn btn-ghost text-xs" onClick={() => void copyTextAndToast(buildTaskReviewMessage(props.card), "Slack review message", toast)}>Copy Slack review message</button> : null}
    </div>
    {actions.dialogs}
  </>;
}
