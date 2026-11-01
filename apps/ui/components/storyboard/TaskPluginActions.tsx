"use client";

import type { ContextMenuGroup } from "@/components/shell/ContextMenu";
import type { BoardCard } from "../../../../packages/shared/ui-lib/storyboard/notes-board-shared";
import { useState } from "react";
import { ModalShell } from "@/components/shell/ModalShell";
import { RuntimeSlotView, useRuntimeSlots } from "@/components/plugins/RuntimeSlots";
import { isTaskOwnershipBlocked } from "@shared/tasks/types.ts";

export function useTaskPluginActions(card: BoardCard, profile?: string) {
  const catalog = useRuntimeSlots("task");
  const [selected, setSelected] = useState<string | null>(null);
  const available = !!profile && !!card.task?.createdAt && !isTaskOwnershipBlocked(card.task) && !card.taskDone && !card.task?.abandonedAt && !card.task?.endDate;
  const slots = available ? catalog.slots : [];
  const entry = slots.find((entry) => `${entry.plugin}/${entry.id}` === selected);
  const open = (id: string) => setSelected(id);
  const groups: ContextMenuGroup[] = slots.length ? [{ id: "plugins", label: "Plugins", items: slots.map((entry) => ({ id: `${entry.plugin}/${entry.id}`, label: entry.label, onSelect: () => open(`${entry.plugin}/${entry.id}`) })) }] : [];
  return {
    visible: slots.length > 0,
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
  if (actions.error) return <p role="status" className="text-xs text-text-muted">Plugin actions unavailable. <button type="button" className="btn btn-ghost" onClick={actions.retry}>Retry</button></p>;
  if (!actions.visible) return null;
  return <><div className="flex flex-wrap gap-1">{actions.groups.flatMap((group) => group.items.map((item) => <button type="button" className="btn btn-ghost text-xs" key={item.id} onClick={() => actions.open(item.id)}>{item.label}</button>))}</div>{actions.dialogs}</>;
}
