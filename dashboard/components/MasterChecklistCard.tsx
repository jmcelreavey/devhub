"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { MasterList, MasterListItem } from "@/lib/checklists/types";
import { formatMasterScopeDisplay } from "@/lib/checklists/paths";
import { masterSummary } from "@/lib/checklists/resolution";
import { ChecklistRow } from "@/components/ChecklistRow";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/lib/use-toast";
import type { ChecklistIconName } from "@/lib/checklists/icons";
import { ChecklistIconPicker } from "@/components/ChecklistIconPicker";

export interface MasterChecklistCardProps {
  master: MasterList;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
  onToggleItem: (item: MasterListItem, checked: boolean) => Promise<void>;
}

export function MasterChecklistCard({
  master,
  onPatch,
  onDelete,
  onToggleItem,
}: MasterChecklistCardProps) {
  const [itemDraft, setItemDraft] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const confirm = useConfirm();
  const toast = useToast();

  const addItem = async () => {
    if (!itemDraft.trim()) return;
    await onPatch({
      action: "addItem",
      item: { name: itemDraft.trim(), checked: false },
    });
    setItemDraft("");
  };

  const commitItemRename = async (item: MasterListItem) => {
    const trimmed = editDraft.trim();
    setEditingItemId(null);
    if (!trimmed || trimmed === item.name) return;

    try {
      await onPatch({ action: "updateItem", itemId: item.id, item: { name: trimmed } });
    } catch {
      return;
    }

    try {
      const driftRes = await fetch(
        `/api/collections/${master.id}/linked-label-drift?itemId=${encodeURIComponent(item.id)}`,
      );
      if (!driftRes.ok) return;
      const drift = (await driftRes.json()) as {
        driftedEntries: number;
        notePaths: string[];
      };
      if (drift.driftedEntries <= 0) return;

      const ok = await confirm({
        title: "Update linked notes?",
        message: `${drift.driftedEntries} linked row(s) in ${drift.notePaths.length} note(s) still show "${item.name}". Update them to "${trimmed}"?`,
        confirmLabel: "Update all",
      });
      if (!ok) return;

      const syncRes = await fetch(`/api/collections/${master.id}/sync-linked-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, label: trimmed }),
      });
      if (!syncRes.ok) throw new Error();
      const result = (await syncRes.json()) as { entriesUpdated: number };
      toast.success(`Updated ${result.entriesUpdated} linked row(s) in notes.`);
    } catch {
      toast.error("Couldn't update linked rows in notes.");
    }
  };

  return (
    <article className="card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <ChecklistIconPicker
            inline
            triggerIconSize={22}
            triggerClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-overlay)]"
            value={(master.icon ?? "list") as ChecklistIconName}
            triggerAriaLabel={`Change icon for ${master.name}`}
            onChange={(icon) =>
              void onPatch({
                action: "updateCollection",
                collection: { icon },
              })
            }
          />
          <div>
            <h2 className="text-lg font-semibold">{master.name}</h2>
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              {formatMasterScopeDisplay(master.scopePath)} · {masterSummary(master)}
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-danger-ghost text-sm" onClick={() => void onDelete()}>
          <Trash2 size={14} aria-hidden /> Delete
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder="Add item…"
          value={itemDraft}
          onChange={(e) => setItemDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addItem();
          }}
        />
        <button type="button" className="btn btn-primary text-sm" onClick={() => void addItem()}>
          Add
        </button>
      </div>

      {master.items.length > 0 ? (
        <div className="space-y-0.5">
          {master.items.map((item) =>
            editingItemId === item.id ? (
              <div key={item.id} className="flex items-center gap-2 rounded px-1.5 py-1">
                <input
                  className="input min-w-0 flex-1 text-sm"
                  value={editDraft}
                  autoFocus
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitItemRename(item);
                    if (e.key === "Escape") setEditingItemId(null);
                  }}
                  onBlur={() => void commitItemRename(item)}
                />
              </div>
            ) : (
              <div key={item.id} className="group/item flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <ChecklistRow
                    label={item.name}
                    checked={item.checked}
                    linked
                    masterName={master.name}
                    onToggle={() => void onToggleItem(item, !item.checked)}
                    onDelete={() => void onPatch({ action: "deleteItem", itemId: item.id })}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0 opacity-0 transition-opacity group-hover/item:opacity-100"
                  style={{ padding: "4px 6px", color: "var(--text-subtle)" }}
                  title={`Rename ${item.name}`}
                  onClick={() => {
                    setEditingItemId(item.id);
                    setEditDraft(item.name);
                  }}
                >
                  <Pencil size={13} aria-hidden />
                </button>
              </div>
            ),
          )}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
          No items yet. Add tools or supplies you want to track across notes.
        </p>
      )}
    </article>
  );
}
