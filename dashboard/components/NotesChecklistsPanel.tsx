"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { MasterList, MasterListItem } from "@/lib/checklists/types";
import { normalizeScopePath, parentScopePath } from "@/lib/checklists/paths";
import { MasterChecklistCard } from "@/components/MasterChecklistCard";
import { EmptyState, FetchError, SearchInput, SkeletonRows } from "@/components";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { useChecklistSync } from "@/lib/checklists/use-checklist-sync";
import type { ChecklistIconName } from "@/lib/checklists/icons";
import { ChecklistIconPicker } from "@/components/ChecklistIconPicker";

const PAGE_SIZE = 10;

export function NotesChecklistsPanel({
  embedded = false,
  initialNotePath = "",
  initialScopePath = "",
}: {
  embedded?: boolean;
  initialNotePath?: string;
  initialScopePath?: string;
}) {
  const { data, error, isLoading, mutate } = useLive<MasterList[]>("/api/collections");
  const masters = useMemo(() => data ?? [], [data]);
  const toast = useToast();
  const confirm = useConfirm();
  const { toggleMasterItem, patchMasterCache } = useChecklistSync();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(() => Boolean(initialScopePath || initialNotePath));
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState(() => {
    if (initialScopePath) return normalizeScopePath(initialScopePath);
    if (initialNotePath) return parentScopePath(initialNotePath) || normalizeScopePath(initialNotePath);
    return "";
  });
  const [newIcon, setNewIcon] = useState<ChecklistIconName>("list");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return masters;
    return masters.filter((m) =>
      [m.name, m.scopePath || "all notes"].some((part) => part.toLowerCase().includes(q)),
    );
  }, [masters, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);

  const patchMaster = (masterId: string, body: Record<string, unknown>) =>
    patchMasterCache(masterId, body, () =>
      fetch(`/api/collections/${masterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const createMaster = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          scopePath: normalizeScopePath(newScope),
          icon: newIcon,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await mutate();
      setNewName("");
      setShowCreate(false);
      setPage(1);
      toast.success("Checklist created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create checklist.");
    }
  };

  const deleteMaster = async (master: MasterList) => {
    const itemCount = master.items.length;
    const ok = await confirm({
      title: "Delete checklist",
      message: `Delete "${master.name}"? This removes ${itemCount} master item${itemCount === 1 ? "" : "s"}. Notes that linked those items may show broken links.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/collections/${master.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await mutate(masters.filter((m) => m.id !== master.id), { revalidate: true });
      toast.success("Checklist deleted.");
    } catch {
      toast.error("Couldn't delete checklist.");
    }
  };

  const handleToggleItem = async (master: MasterList, item: MasterListItem, checked: boolean) => {
    try {
      await toggleMasterItem(master.id, item.id, checked);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      toast.error(detail ? `Couldn't update item: ${detail}` : "Couldn't update item.");
    }
  };

  const wrapperClass = embedded ? "p-4 md:p-6 max-w-3xl mx-auto w-full" : "page-wrapper";

  return (
    <div className={wrapperClass}>
      <div className={embedded ? "mb-4 flex items-start justify-between gap-3" : "page-header items-start"}>
        <div className="min-w-0 flex-1">
          <h1 className={embedded ? "text-lg font-semibold" : "page-title"}>Checklists</h1>
          <p className={embedded ? "mt-1 text-xs" : "page-subtitle"} style={{ color: "var(--text-subtle)" }}>
            Master checklists for a notes folder or all notes. Link tasks in notes to share checked state.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 self-center">
          <span className="badge badge-muted shrink-0">{masters.length}</span>
          <button
            type="button"
            className="btn btn-primary shrink-0 whitespace-nowrap text-sm"
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus size={14} aria-hidden />
            {showCreate ? "Cancel" : "New checklist"}
          </button>
        </div>
      </div>

      <SearchInput
        value={query}
        onChange={(q) => {
          setQuery(q);
          setPage(1);
        }}
        placeholder="Search checklists by name or folder…"
      />

      {showCreate ? (
        <div className="card card-body mb-4 space-y-3">
          <p className="text-sm font-medium">New checklist</p>
          <div className="flex items-center gap-2">
            <ChecklistIconPicker
              inline
              triggerIconSize={20}
              value={newIcon}
              onChange={setNewIcon}
              triggerAriaLabel="Choose checklist icon"
              triggerClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-overlay)]"
            />
            <input
              className="input min-w-0 flex-1 text-sm"
              placeholder="List name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <input
            className="input w-full text-sm"
            placeholder="Notes folder (optional, e.g. garden)"
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            aria-describedby="new-checklist-scope-hint"
          />
          <p id="new-checklist-scope-hint" className="text-xs" style={{ color: "var(--text-subtle)" }}>
            Leave blank to apply this checklist to all notes. Folder-specific checklists take precedence
            when a note is inside that folder.
          </p>
          <button type="button" className="btn btn-primary text-sm" onClick={() => void createMaster()}>
            Create checklist
          </button>
        </div>
      ) : null}

      {error ? <FetchError message="Couldn't load checklists." onRetry={() => mutate()} /> : null}

      {isLoading && !data ? <SkeletonRows count={2} height={120} /> : null}

      {!isLoading && filtered.length === 0 ? (
        <EmptyState
          title={query ? "No matching checklists" : "No checklists yet"}
          subtitle={query ? "Try a different search." : "Create one to get started."}
        />
      ) : null}

      {!isLoading && filtered.length > 0 ? (
        <>
          {filtered.length > PAGE_SIZE ? (
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                Showing {rangeStart}–{rangeEnd} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={12} aria-hidden /> Prev
                </button>
                <span className="text-xs" style={{ color: "var(--text-subtle)" }}>
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight size={12} aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {visible.map((master) => (
              <MasterChecklistCard
                key={master.id}
                master={master}
                onPatch={(body) =>
                  patchMaster(master.id, body).catch((err) => {
                    const detail = err instanceof Error ? err.message : "";
                    toast.error(detail ? `Couldn't update checklist: ${detail}` : "Couldn't update checklist.");
                  })
                }
                onDelete={() => deleteMaster(master)}
                onToggleItem={(item, checked) => handleToggleItem(master, item, checked)}
              />
            ))}
          </div>
        </>
      ) : null}

      {initialNotePath ? (
        <p className="mt-4 text-sm" style={{ color: "var(--text-subtle)" }}>
          <Link href={`/notes/${initialNotePath.split("/").map(encodeURIComponent).join("/")}`}>
            Back to note
          </Link>
        </p>
      ) : null}
    </div>
  );
}
