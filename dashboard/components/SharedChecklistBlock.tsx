"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useBlockNoteEditor } from "@blocknote/react";
import { Link as LinkIcon } from "lucide-react";
import { ChecklistRow } from "@/components/ChecklistRow";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLive } from "@/lib/use-fetch";
import type { MasterList, SharedChecklistEntry } from "@/lib/checklists/types";
import {
  entryDisplayChecked,
  entryIsBrokenLink,
  entryLabelDrift,
  masterItemById,
} from "@/lib/checklists/resolution";
import { detachEntry, syncEntryLabel } from "@/lib/checklists/entry-label-sync";
import { useNoteEditorPath } from "@/lib/note-editor-context";
import {
  parseSharedChecklistEntries,
  stringifySharedChecklistEntries,
} from "@/lib/checklists/note-blocks";
import { useChecklistSync } from "@/lib/checklists/use-checklist-sync";
import { notesChecklistsHref } from "@/lib/checklists/notes-url";
import { useToast } from "@/lib/use-toast";
import { ChecklistIcon } from "@/lib/checklists/icons";

interface SharedChecklistBlockViewProps {
  masterListId: string;
  entriesJson: string;
  width: number;
  blockId: string;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 460;

function newEntryId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

export function SharedChecklistBlockView({
  masterListId,
  entriesJson,
  width,
  blockId,
}: SharedChecklistBlockViewProps) {
  const editor = useBlockNoteEditor();
  const toast = useToast();
  const confirm = useConfirm();
  const notePath = useNoteEditorPath();
  const { toggleMasterItem, promoteToMaster } = useChecklistSync();
  const { data: masters, error, isLoading } = useLive<MasterList[]>("/api/collections", {
    refreshInterval: 15_000,
  });
  const master = useMemo(
    () => (masters ?? []).find((m) => m.id === masterListId),
    [masters, masterListId],
  );
  const entries = useMemo(() => parseSharedChecklistEntries(entriesJson), [entriesJson]);
  const [addDraft, setAddDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const resolvedWidth = draftWidth ?? (width > 0 ? clampWidth(width) : DEFAULT_WIDTH);

  const linkedIds = useMemo(
    () => new Set(entries.map((e) => e.masterItemId).filter(Boolean)),
    [entries],
  );

  const pickerOptions = useMemo(() => {
    if (!master || !addDraft.trim()) return [];
    const q = addDraft.trim().toLowerCase();
    return master.items.filter(
      (item) => !linkedIds.has(item.id) && item.name.toLowerCase().includes(q),
    );
  }, [master, addDraft, linkedIds]);

  const persistBlock = useCallback(
    (props: Partial<{ entriesJson: string; width: number }>) => {
      const block = editor.document.find((b) => b.id === blockId);
      if (!block) return;
      editor.updateBlock(block, { props });
    },
    [editor, blockId],
  );

  const persistEntries = useCallback(
    (next: SharedChecklistEntry[]) => {
      persistBlock({ entriesJson: stringifySharedChecklistEntries(next) });
    },
    [persistBlock],
  );

  const handleToggle = async (entry: SharedChecklistEntry) => {
    if (entry.masterItemId && master) {
      const checked = !entryDisplayChecked(entry, master);
      try {
        await toggleMasterItem(masterListId, entry.masterItemId, checked);
      } catch {
        toast.error("Couldn't update master list.");
      }
      return;
    }
    persistEntries(
      entries.map((row) =>
        row.id === entry.id ? { ...row, standaloneChecked: !(row.standaloneChecked ?? false) } : row,
      ),
    );
  };

  const addStandalone = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    persistEntries([
      ...entries,
      { id: newEntryId(), label: trimmed, standaloneChecked: false },
    ]);
    setAddDraft("");
    setPickerOpen(false);
  };

  const linkMasterItem = (item: { id: string; name: string }) => {
    persistEntries([
      ...entries,
      { id: newEntryId(), label: item.name, masterItemId: item.id },
    ]);
    setAddDraft("");
    setPickerOpen(false);
  };

  const handlePromote = async (entry: SharedChecklistEntry) => {
    if (!master) return;
    try {
      const item = await promoteToMaster(
        masterListId,
        entry.label,
        entry.standaloneChecked ?? false,
      );
      if (!item?.id) throw new Error("promote failed");
      persistEntries(
        entries.map((row) =>
          row.id === entry.id
            ? { ...row, masterItemId: item.id, standaloneChecked: undefined }
            : row,
        ),
      );
      toast.success(`Added to ${master.name}`);
    } catch {
      toast.error("Couldn't add to master list.");
    }
  };

  const handleDetach = (entry: SharedChecklistEntry) => {
    persistEntries(detachEntry(entries, entry.id));
  };

  const handleAcceptMasterLabel = async (entry: SharedChecklistEntry) => {
    if (!entry.masterItemId || !master) return;
    const item = masterItemById(master, entry.masterItemId);
    if (!item) return;

    persistEntries(syncEntryLabel(entries, entry.id, item.name));

    try {
      const params = new URLSearchParams({ itemId: entry.masterItemId });
      if (notePath) params.set("excludeNotePath", notePath);
      const driftRes = await fetch(
        `/api/collections/${masterListId}/linked-label-drift?${params.toString()}`,
      );
      if (!driftRes.ok) return;
      const drift = (await driftRes.json()) as {
        driftedEntries: number;
        notePaths: string[];
      };
      if (drift.driftedEntries <= 0) return;

      const ok = await confirm({
        title: "Update other notes?",
        message: `${drift.driftedEntries} linked row(s) in ${drift.notePaths.length} other note(s) still show the old name. Update them to "${item.name}"?`,
        confirmLabel: "Update all",
      });
      if (!ok) return;

      const syncRes = await fetch(`/api/collections/${masterListId}/sync-linked-labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: entry.masterItemId,
          label: item.name,
          excludeNotePath: notePath,
        }),
      });
      if (!syncRes.ok) throw new Error();
      const result = (await syncRes.json()) as { entriesUpdated: number };
      toast.success(
        result.entriesUpdated > 0
          ? `Updated ${result.entriesUpdated} linked row(s) in other notes.`
          : "Other notes were already up to date.",
      );
    } catch {
      toast.error("Couldn't update linked rows in other notes.");
    }
  };

  const handleKeepLocalLabel = async (entry: SharedChecklistEntry) => {
    const ok = await confirm({
      title: "Keep this name?",
      message: `Keep "${entry.label}" as a note-only task? It will no longer stay linked to the master list.`,
      confirmLabel: "Unlink",
    });
    if (!ok) return;
    handleDetach(entry);
  };

  const removeEntry = (entryId: string) => {
    persistEntries(entries.filter((row) => row.id !== entryId));
  };

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = containerRef.current?.getBoundingClientRect().width ?? resolvedWidth;

    const onMove = (e: MouseEvent) => {
      setDraftWidth(clampWidth(startWidth + (e.clientX - startX)));
    };
    const onUp = (e: MouseEvent) => {
      const finalWidth = clampWidth(startWidth + (e.clientX - startX));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraftWidth(null);
      persistBlock({ width: finalWidth });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => () => setDraftWidth(null), []);

  const inputPlaceholder = master
    ? entries.length === 0
      ? `Add a task or pick from ${master.name}…`
      : "Add task…"
    : "Add note-only task…";

  return (
    <div
      ref={containerRef}
      contentEditable={false}
      suppressContentEditableWarning
      className="group relative rounded border px-3 py-2.5 text-sm"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-surface)",
        color: "var(--text)",
        width: resolvedWidth,
        maxWidth: "100%",
      }}
      data-devhub-shared-checklist-id={masterListId}
    >
      {error ? (
        <p className="mb-2 text-xs" style={{ color: "var(--danger)" }}>
          Could not load checklist.
        </p>
      ) : null}

      {master ? (
        <div
          className="mb-2 flex items-center gap-1.5 text-xs"
          style={{ color: "var(--text-subtle)" }}
        >
          <ChecklistIcon name={master.icon} size={12} style={{ color: "var(--accent)" }} />
          <span className="truncate">{master.name}</span>
        </div>
      ) : null}

      {!master && !isLoading ? (
        <div
          className="mb-2 flex items-center justify-between gap-3 text-xs"
          style={{ color: "var(--text-subtle)" }}
        >
          <span>Linked checklist unavailable</span>
          <Link href={notesChecklistsHref()} className="btn btn-ghost text-xs" contentEditable={false}>
            Open checklists
          </Link>
        </div>
      ) : null}

      <div className="space-y-0.5">
        {entries.map((entry) => {
          const drifted = entryLabelDrift(entry, master);
          const masterLabel = entry.masterItemId
            ? masterItemById(master, entry.masterItemId)?.name
            : undefined;
          return (
          <ChecklistRow
            key={entry.id}
            label={entry.label}
            checked={entryDisplayChecked(entry, master)}
            linked={Boolean(entry.masterItemId)}
            brokenLink={entryIsBrokenLink(entry, master)}
            renamedInMaster={drifted}
            masterLabel={masterLabel}
            masterName={master?.name}
            onToggle={() => void handleToggle(entry)}
            onPromote={!entry.masterItemId && master ? () => void handlePromote(entry) : undefined}
            onDetach={entryIsBrokenLink(entry, master) ? () => handleDetach(entry) : undefined}
            onAcceptMasterLabel={
              drifted && entry.masterItemId ? () => void handleAcceptMasterLabel(entry) : undefined
            }
            onKeepLocalLabel={
              drifted && entry.masterItemId ? () => void handleKeepLocalLabel(entry) : undefined
            }
            onDelete={() => removeEntry(entry.id)}
          />
          );
        })}
      </div>

      {isLoading && entries.length === 0 ? (
        <div className="space-y-2" aria-label="Loading checklist">
          <div className="skeleton h-6 w-full rounded" />
          <div className="skeleton h-6 w-3/4 rounded" />
        </div>
      ) : null}

      <div className="relative mt-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
        <input
          type="text"
          contentEditable={false}
          className="input w-full text-sm"
          placeholder={inputPlaceholder}
          value={addDraft}
          onChange={(e) => {
            setAddDraft(e.target.value);
            setPickerOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (pickerOptions.length === 1) {
                linkMasterItem(pickerOptions[0]);
              } else {
                addStandalone(addDraft);
              }
            }
            if (e.key === "Escape") setPickerOpen(false);
          }}
          onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
        />
        {pickerOpen && pickerOptions.length > 0 ? (
          <ul
            className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded border py-1 shadow-lg"
            style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
          >
            {pickerOptions.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  contentEditable={false}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-overlay)]"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    linkMasterItem(item);
                  }}
                >
                  <LinkIcon size={12} style={{ color: "var(--accent)" }} aria-hidden />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto text-xs" style={{ color: "var(--text-subtle)" }}>
                    Link
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        contentEditable={false}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize checklist"
        title="Drag to resize"
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize select-none reveal-on-hover transition-opacity hover:bg-[var(--accent)]"
        style={{ borderTopRightRadius: "inherit", borderBottomRightRadius: "inherit" }}
      />
    </div>
  );
}
