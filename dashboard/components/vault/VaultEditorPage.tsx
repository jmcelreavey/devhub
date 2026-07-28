"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { mutate } from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BlockNoteEditor } from "@/components/BlockNoteEditor";
import {
  BookOpen,
  Check,
  ChevronRight,
  FolderInput,
  Link2,
  ListChecks,
  Save,
  Trash2,
} from "lucide-react";
import { useToast } from "@/lib/hooks/use-toast";
import { MoveVaultPathModal } from "@/components/MoveVaultPathModal";
import { HoverTip } from "@/components/ui/HoverTip";
import { useConfirm } from "@/components/shell/ConfirmDialog";
import { useLive } from "@/lib/hooks/use-fetch";
import type { MasterList } from "@/lib/checklists/types";
import {
  migrateNoteBlocks,
  noteBlocksHaveLegacyCollection,
} from "@/lib/checklists/note-blocks";
import { getMasterForNotePath, parentScopePath } from "@/lib/checklists/paths";
import { notesChecklistsHref } from "@/lib/checklists/notes-url";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
import { NotePageTitle } from "@/components/notes/NotePageTitle";
import { ShareControls } from "@/components/ShareControls";
import { VaultEditorNav } from "@/components/vault/VaultEditorNav";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import { splitFrontmatterBlock } from "@/lib/docs/frontmatter";
import {
  isCurrentNoteSaveGeneration,
  nextNoteSaveGeneration,
} from "@/lib/notes/save-generation";
import {
  broadcastNoteAutosaveInvalidation,
  useNoteAutosaveInvalidationListener,
} from "@/lib/notes/autosave-invalidation";
import { EntityRelationsPanel } from "@/components/EntityRelationsPanel";
import { EntityLinkDialog } from "@/components/EntityLinkDialog";
import {
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  upsertEntityLinksInMarkdown,
} from "@/lib/entity-note";

export function VaultEditorPage({
  vault: vaultId,
  path: pathParts,
  notesAiConfigured,
  readHref,
}: {
  vault: VaultId;
  path: string[];
  notesAiConfigured?: boolean;
  /** When set, shows a "Done" link back to the rendered read view (docs only). */
  readHref?: string;
}) {
  const vault = getVaultClient(vaultId);
  const { paths, apiPrefix, pagePrefix, itemLabel } = vault;
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const filePath = pathParts.join("/");
  const [blocks, setBlocks] = useState<DevHubPartialBlock[] | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  /** Bumped when ## Links are written outside the editor so BlockNote remounts. */
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const isNotes = vaultId === "notes";
  const { data: allMasters } = useLive<MasterList[]>(
    isNotes && !isNew ? "/api/collections" : null,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped on navigation/delete so debounced saves cannot write a prior note. */
  const saveGenerationRef = useRef(0);
  const isNewRef = useRef(isNew);
  const allMastersRef = useRef(allMasters);
  const pendingLegacyMigrationRef = useRef(false);
  /** Raw frontmatter block for the doc being edited; re-prepended on save. */
  const docFrontmatterRef = useRef("");

  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const invalidatePendingSave = useCallback(() => {
    saveGenerationRef.current = nextNoteSaveGeneration(saveGenerationRef.current);
    cancelPendingSave();
  }, [cancelPendingSave]);

  useNoteAutosaveInvalidationListener(filePath, invalidatePendingSave);

  useEffect(() => {
    isNewRef.current = isNew;
  }, [isNew]);

  useEffect(() => {
    invalidatePendingSave();
    return cancelPendingSave;
  }, [filePath, invalidatePendingSave, cancelPendingSave]);

  useEffect(() => {
    allMastersRef.current = allMasters;
  }, [allMasters]);

  useEffect(() => {
    pendingLegacyMigrationRef.current = false;
    docFrontmatterRef.current = "";
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setError(null);
    setIsNew(false);
    setEditorEpoch(0);
    fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) {
            setIsNew(true);
            setBlocks([]);
            return null;
          }
          throw new Error(`${r.status} ${r.statusText}`);
        }
        return r.json();
      })
      .then((data: { content: unknown } | null) => {
        if (cancelled) return;
        if (data) {
          if (vaultId === "docs") {
            const md = typeof data.content === "string" ? data.content : "";
            // Frontmatter is metadata, not prose. Hold it aside verbatim so the
            // editor never shows it and a save cannot mangle it.
            const { block, body } = splitFrontmatterBlock(md);
            docFrontmatterRef.current = block;
            setBlocks(textToBlocks(body) as DevHubPartialBlock[]);
            return;
          }
          const content = Array.isArray(data.content) ? data.content : [];
          const raw = content as Parameters<typeof migrateNoteBlocks>[0];
          const masters = allMastersRef.current;
          pendingLegacyMigrationRef.current =
            !masters && noteBlocksHaveLegacyCollection(raw);
          setBlocks(
            migrateNoteBlocks(raw, filePath, masters ?? []) as DevHubPartialBlock[],
          );
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiPrefix, filePath, paths, vaultId]);

  useEffect(() => {
    if (!isNotes || !allMasters || !pendingLegacyMigrationRef.current) return;
    pendingLegacyMigrationRef.current = false;
    setBlocks((prev) => {
      if (!prev || !noteBlocksHaveLegacyCollection(prev as Parameters<typeof noteBlocksHaveLegacyCollection>[0])) return prev;
      return migrateNoteBlocks(
        prev as Parameters<typeof migrateNoteBlocks>[0],
        filePath,
        allMasters,
      ) as DevHubPartialBlock[];
    });
  }, [allMasters, filePath, isNotes]);

  const handleChange = useCallback(
    (newBlocks: DevHubPartialBlock[]) => {
      cancelPendingSave();
      const generation = saveGenerationRef.current;
      setStatus("saving");
      saveTimer.current = setTimeout(async () => {
        if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
        try {
          const wasNew = isNewRef.current;
          const method = wasNew ? "POST" : "PUT";
          const bodyContent =
            vaultId === "docs"
              ? `${docFrontmatterRef.current}${blocksToText(newBlocks)}`
              : newBlocks;
          const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: bodyContent }),
          });
          if (!r.ok) throw new Error(await r.text());
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          if (wasNew) {
            setIsNew(false);
            router.refresh();
          }
          setStatus("saved");
          setLastSaved(new Date());
          // Refresh share drift status (SWR dedupes rapid saves).
          void mutate("/api/share");
          setTimeout(() => setStatus("idle"), 2000);
        } catch (e) {
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          setError(String(e));
          setStatus("error");
        }
      }, 1500);
    },
    [apiPrefix, cancelPendingSave, filePath, paths, router, vaultId],
  );

  const handleDelete = useCallback(async () => {
    if (isNew) return;
    const label = filePath.split("/").pop() ?? filePath;
    const ok = await confirm({
      title: `Delete ${itemLabel}`,
      message: `Delete "${label}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    broadcastNoteAutosaveInvalidation(filePath);
    invalidatePendingSave();
    setDeleting(true);
    try {
      const res = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? res.statusText);
      }
      router.push(pagePrefix);
      router.refresh();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : `Could not delete ${itemLabel}.`);
    } finally {
      setDeleting(false);
    }
  }, [apiPrefix, confirm, filePath, invalidatePendingSave, isNew, itemLabel, pagePrefix, paths, router, toast]);

  const guardedRenameFile = useCallback(
    async (currentSlug: string, newBaseName: string) => {
      invalidatePendingSave();
      return paths.renameFile(currentSlug, newBaseName);
    },
    [invalidatePendingSave, paths],
  );

  const persistBlocksImmediate = useCallback(
    async (newBlocks: DevHubPartialBlock[]) => {
      cancelPendingSave();
      const generation = saveGenerationRef.current;
      const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newBlocks }),
      });
      if (!r.ok) throw new Error(await r.text());
      if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
      setBlocks(newBlocks);
      setEditorEpoch((n) => n + 1);
      setStatus("saved");
      setLastSaved(new Date());
      void mutate("/api/share");
      setTimeout(() => setStatus("idle"), 2000);
    },
    [apiPrefix, cancelPendingSave, filePath, paths],
  );

  const handleMoved = useCallback(
    (newPath: string) => {
      toast.success("Moved.");
      router.push(paths.pageHref(newPath));
      router.refresh();
    },
    [paths, router, toast],
  );

  const title = pathParts[pathParts.length - 1] ?? filePath;

  const handleRenamed = useCallback(
    (newSlug: string) => {
      router.push(paths.pageHref(newSlug));
      router.refresh();
    },
    [paths, router],
  );

  const folderMaster = isNotes && allMasters ? getMasterForNotePath(filePath, allMasters) : undefined;
  const createMasterScope = isNotes
    ? parentScopePath(filePath) || filePath.split("/")[0] || filePath
    : "";

  if (loading) {
    return (
      <div className="page-wrapper">
        <div className="space-y-3">
          <div className="skeleton" style={{ height: "24px", width: "40%" }} />
          <div className="skeleton" style={{ height: "16px", width: "90%" }} />
          <div className="skeleton" style={{ height: "16px", width: "60%" }} />
          <div className="skeleton" style={{ height: "16px", width: "80%" }} />
        </div>
      </div>
    );
  }

  if (error && !blocks && !isNew) {
    return (
      <div className="page-wrapper">
        <div
          className="badge badge-danger mb-4 block px-3 py-2 rounded"
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <VaultEditorNav vaultId={vaultId} />
      <div className="page-header" style={{ marginBottom: "12px", alignItems: "flex-start" }}>
        <div className="min-w-0 overflow-hidden">
          {pathParts.length > 1 ? (
            <nav
              className="flex items-center gap-1 flex-wrap mb-1 text-xs text-text-subtle"
              aria-label="Breadcrumb"
            >
              <Link
                href={pagePrefix}
                className="hover:underline text-text-muted"
              >
                Index
              </Link>
              <ChevronRight size={10} aria-hidden />
              {pathParts.slice(0, -1).map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span>{part}</span>
                  <ChevronRight size={10} aria-hidden />
                </span>
              ))}
              {isNotes ? (
                <NotePageTitle
                  noteSlug={filePath}
                  title={title}
                  nested
                  isNew={isNew}
                  onRenamed={handleRenamed}
                  renameFile={isNotes ? guardedRenameFile : undefined}
                />
              ) : (
                <span className="text-lg font-semibold text-text">
                  {title}
                </span>
              )}
            </nav>
          ) : (
            <nav
              className="flex items-center gap-1 flex-wrap text-xs text-text-subtle"
              aria-label="Breadcrumb"
            >
              <Link
                href={pagePrefix}
                className="hover:underline text-text-muted"
              >
                Index
              </Link>
              <ChevronRight size={10} aria-hidden />
              {isNotes ? (
                <NotePageTitle
                  noteSlug={filePath}
                  title={title}
                  nested
                  isNew={isNew}
                  onRenamed={handleRenamed}
                  renameFile={isNotes ? guardedRenameFile : undefined}
                />
              ) : (
                <span className="text-lg font-semibold text-text">
                  {title}
                </span>
              )}
            </nav>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <div className="text-xs text-text-subtle">
            {status === "saving" && (
              <span className="flex items-center gap-1 text-warning">
                <Save size={12} className="animate-pulse" /> Saving…
              </span>
            )}
            {status === "saved" && (
              <span className="flex items-center gap-1 text-success">
                <Check size={12} /> Saved
              </span>
            )}
            {status === "error" && <span className="text-danger">Error</span>}
            {status === "idle" && lastSaved && (
              <span>Saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            )}
          </div>
          {readHref ? (
            <Link
              href={readHref}
              className="btn btn-primary text-xs flex items-center gap-1 shrink-0 no-underline"
              title="Back to the rendered doc"
            >
              <BookOpen size={13} aria-hidden />
              Done
            </Link>
          ) : null}
          {!isNew && (
            <>
              <ShareControls vaultId={vaultId} path={filePath} />
              {isNotes && !isNew && blocks ? (
                <button
                  type="button"
                  className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                  onClick={() => {
                    window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
                    setLinkOpen(true);
                  }}
                >
                  <Link2 size={14} aria-hidden />
                  Add link
                </button>
              ) : null}
              {isNotes && !folderMaster ? (
                <Link
                  href={notesChecklistsHref({ notePath: filePath, scope: createMasterScope ?? "" })}
                  className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                  title={`Create checklist for ${createMasterScope || "this note"}`}
                >
                  <ListChecks size={14} aria-hidden />
                  Create checklist
                </Link>
              ) : null}
              <button
                type="button"
                title={`Move ${title}`}
                onClick={() => setMoveModalOpen(true)}
                className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
              >
                <FolderInput size={14} aria-hidden />
                Move
              </button>
              <HoverTip label={deleting ? "Deleting…" : `Delete ${title}`}>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="btn btn-danger-ghost text-xs flex items-center gap-1 shrink-0"
                >
                  <Trash2 size={14} aria-hidden />
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </HoverTip>
            </>
          )}
        </div>
      </div>

      {!isNotes && (blocks !== null || isNew) ? (
        <p className="text-xs mb-3 text-text-subtle">
          Saved as Markdown on disk. Complex tables or raw HTML may shift slightly after edit - review diffs
          before syncing.
        </p>
      ) : null}

      {blocks !== null || isNew ? (
        <BlockNoteEditor
          key={`${filePath}:${editorEpoch}`}
          initialContent={blocks && blocks.length > 0 ? blocks : undefined}
          onChange={handleChange}
          notePath={isNotes ? filePath : undefined}
          vaultId={vaultId}
          contentSlug={filePath}
          notesAiConfigured={isNotes ? notesAiConfigured : false}
          enableAi={isNotes ? undefined : false}
          linkedChecklistContext={
            folderMaster
              ? {
                  masterListId: folderMaster.id,
                  masterName: folderMaster.name,
                  masterIcon: folderMaster.icon,
                }
              : undefined
          }
          style={{ minHeight: "60vh" }}
        />
      ) : null}

      {isNotes && !isNew && blocks ? (
        <EntityRelationsPanel
          notePath={filePath}
          blocks={blocks}
          onAddLink={() => setLinkOpen(true)}
        />
      ) : null}

      {isNotes && !isNew && blocks ? (
        <EntityLinkDialog
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          defaultKind="calendar"
          description="Link a calendar event, PR, task, or Jira issue to this note."
          onSave={async (ref) => {
            const md = blocksToText(blocks);
            const nextRefs = mergeEntityRefs(parseEntityLinksFromMarkdown(md), [ref]);
            const nextMd = upsertEntityLinksInMarkdown(md, nextRefs);
            const nextBlocks = textToBlocks(nextMd) as DevHubPartialBlock[];
            await persistBlocksImmediate(nextBlocks);
            toast.success("Link added");
          }}
        />
      ) : null}

      {moveModalOpen ? (
        <MoveVaultPathModal
          vault={vaultId}
          currentPath={filePath}
          onClose={() => setMoveModalOpen(false)}
          onBeforeMove={invalidatePendingSave}
          onMoved={handleMoved}
        />
      ) : null}
    </div>
  );
}
