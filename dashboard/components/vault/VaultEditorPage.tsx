"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { mutate } from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BlockNoteEditor } from "@/components/BlockNoteEditor";
import {
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  FileCheck2,
  FolderInput,
  Link2,
  ListChecks,
  Loader2,
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
import { LaunchMenu } from "@/components/shell/LaunchMenu";
import {
  applyCursorNoteDraft,
  deleteCursorNoteDraft,
  openRepoInCursor,
} from "@/lib/open-in-cursor-client";
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
  const [docBody, setDocBody] = useState<string | null>(null);
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
  const [cursorDraftRepo, setCursorDraftRepo] = useState<string | null>(null);
  const [applyingCursorDraft, setApplyingCursorDraft] = useState(false);
  const isNotes = vaultId === "notes";
  const { data: allMasters } = useLive<MasterList[]>(
    isNotes && !isNew ? "/api/collections" : null,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Bumped on navigation/delete so debounced saves cannot write a prior note. */
  const saveGenerationRef = useRef(0);
  const sourceModifiedRef = useRef<number | null>(null);
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

  const abortActiveSave = useCallback(() => {
    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
  }, []);

  const invalidatePendingSave = useCallback(() => {
    saveGenerationRef.current = nextNoteSaveGeneration(saveGenerationRef.current);
    cancelPendingSave();
    abortActiveSave();
  }, [abortActiveSave, cancelPendingSave]);

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
    setCursorDraftRepo(null);
    fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) {
            setIsNew(true);
            sourceModifiedRef.current = null;
            setBlocks([]);
            if (vaultId === "docs") setDocBody("");
            return null;
          }
          throw new Error(`${r.status} ${r.statusText}`);
        }
        return r.json();
      })
      .then((data: { content: unknown; modified?: number } | null) => {
        if (cancelled) return;
        if (data) {
          sourceModifiedRef.current = typeof data.modified === "number" ? data.modified : null;
          if (vaultId === "docs") {
            const md = typeof data.content === "string" ? data.content : "";
            // Frontmatter is metadata, not prose. Hold it aside verbatim so the
            // editor never shows it and a save cannot mangle it.
            const { block, body } = splitFrontmatterBlock(md);
            docFrontmatterRef.current = block;
            setDocBody(body);
            setBlocks([]);
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
      setCursorDraftRepo(null);
      cancelPendingSave();
      const generation = nextNoteSaveGeneration(saveGenerationRef.current);
      saveGenerationRef.current = generation;
      setStatus("saving");
      saveTimer.current = setTimeout(async () => {
        const queued = saveQueueRef.current.then(async () => {
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          const controller = new AbortController();
          saveAbortRef.current = controller;
          try {
            const wasNew = isNewRef.current;
            const method = wasNew ? "POST" : "PUT";
            const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: newBlocks,
                ...(method === "PUT" && sourceModifiedRef.current !== null
                  ? { expectedModified: sourceModifiedRef.current }
                  : {}),
              }),
              signal: controller.signal,
            });
            if (!r.ok) throw new Error(await r.text());
            const saved = (await r.json()) as { modified?: number };
            if (typeof saved.modified === "number") sourceModifiedRef.current = saved.modified;
            if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
            if (wasNew) {
              setIsNew(false);
              router.refresh();
            }
            setStatus("saved");
            setLastSaved(new Date());
            // Refresh share drift status (SWR dedupes rapid saves).
            void mutate("/api/share");
          } catch (e) {
            if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
            setError(String(e));
            setStatus("error");
          } finally {
            if (saveAbortRef.current === controller) saveAbortRef.current = null;
          }
        });
        saveQueueRef.current = queued.catch(() => undefined);
        await queued;
      }, 1500);
    },
    [apiPrefix, cancelPendingSave, filePath, paths, router],
  );

  const handleDocChange = useCallback(
    (body: string) => {
      setDocBody(body);
      cancelPendingSave();
      abortActiveSave();
      const generation = nextNoteSaveGeneration(saveGenerationRef.current);
      saveGenerationRef.current = generation;
      setStatus("saving");
      saveTimer.current = setTimeout(async () => {
        if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
        const controller = new AbortController();
        saveAbortRef.current = controller;
        try {
          const wasNew = isNewRef.current;
          const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
            method: wasNew ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `${docFrontmatterRef.current}${body}` }),
            signal: controller.signal,
          });
          if (!r.ok) throw new Error(await r.text());
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          if (wasNew) {
            setIsNew(false);
            router.refresh();
          }
          setStatus("saved");
          setLastSaved(new Date());
          void mutate("/api/share");
        } catch (e) {
          if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
          setError(String(e));
          setStatus("error");
        } finally {
          if (saveAbortRef.current === controller) saveAbortRef.current = null;
        }
      }, 500);
    },
    [abortActiveSave, apiPrefix, cancelPendingSave, filePath, paths, router],
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
      setCursorDraftRepo(null);
      cancelPendingSave();
      await saveQueueRef.current;
      const generation = saveGenerationRef.current;
      const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newBlocks,
          ...(sourceModifiedRef.current !== null
            ? { expectedModified: sourceModifiedRef.current }
            : {}),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const saved = (await r.json()) as { modified?: number };
      if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return;
      setBlocks(newBlocks);
      if (typeof saved.modified === "number") sourceModifiedRef.current = saved.modified;
      setEditorEpoch((n) => n + 1);
      setStatus("saved");
      setLastSaved(new Date());
      void mutate("/api/share");
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

  const handleApplyCursorDraft = useCallback(async () => {
    if (!cursorDraftRepo || status === "saving" || status === "error") return;
    broadcastNoteAutosaveInvalidation(filePath);
    invalidatePendingSave();
    setApplyingCursorDraft(true);
    try {
      const result = await applyCursorNoteDraft(cursorDraftRepo, filePath, toast);
      if (!result) return;
      const content = Array.isArray(result.content) ? result.content : [];
      setBlocks(
        migrateNoteBlocks(
          content as Parameters<typeof migrateNoteBlocks>[0],
          filePath,
          allMasters ?? [],
        ) as DevHubPartialBlock[],
      );
      if ("modified" in result && typeof result.modified === "number") {
        sourceModifiedRef.current = result.modified;
      }
      setEditorEpoch((value) => value + 1);
      setStatus("saved");
      setError(null);
      setLastSaved(new Date());
      void mutate("/api/share");
      toast.success("Applied Cursor changes");
    } finally {
      setApplyingCursorDraft(false);
    }
  }, [allMasters, cursorDraftRepo, filePath, invalidatePendingSave, status, toast]);

  const handleDeleteCursorDraft = useCallback(async () => {
    if (!cursorDraftRepo || applyingCursorDraft) return;
    const ok = await confirm({
      title: "Delete Cursor working copy?",
      message: `Delete the persistent Markdown copy for ${cursorDraftRepo}? The DevHub note is unchanged.`,
      confirmLabel: "Delete copy",
      variant: "danger",
    });
    if (!ok) return;
    if (await deleteCursorNoteDraft(cursorDraftRepo, filePath, toast)) {
      setCursorDraftRepo(null);
      toast.success("Deleted Cursor working copy");
    }
  }, [applyingCursorDraft, confirm, cursorDraftRepo, filePath, toast]);

  const folderMaster = isNotes && allMasters ? getMasterForNotePath(filePath, allMasters) : undefined;
  const createMasterScope = isNotes
    ? parentScopePath(filePath) || filePath.split("/")[0] || filePath
    : "";
  const linkedRepos = useMemo(() => {
    if (!blocks?.length) return [];
    return parseEntityLinksFromMarkdown(blocksToText(blocks))
      .filter((ref) => ref.kind === "repo")
      .map((ref) => ref.id);
  }, [blocks]);

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
          {readHref && status !== "saving" && status !== "error" ? (
            <Link
              href={readHref}
              className="btn btn-primary text-xs flex items-center gap-1 shrink-0 no-underline"
              title="Back to the rendered doc"
            >
              <BookOpen size={13} aria-hidden />
              Done
            </Link>
          ) : readHref ? (
            <span
              className="btn btn-primary text-xs flex items-center gap-1 shrink-0 opacity-50"
              aria-disabled="true"
              title={status === "error" ? "Fix the save error before leaving" : "Waiting for save"}
            >
              <BookOpen size={13} aria-hidden />
              Done
            </span>
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
              {isNotes && linkedRepos.length > 0 ? (
                <LaunchMenu
                  label="Open with"
                  icon={<Code2 size={14} aria-hidden />}
                  buttonClassName="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                  disabled={status === "saving" || status === "error" || applyingCursorDraft}
                  items={linkedRepos.map((repo) => ({
                    id: repo,
                    label: linkedRepos.length === 1 ? "Cursor" : `Cursor · ${repo}`,
                    description: `Open this note with ${repo}`,
                    icon: <Code2 size={14} aria-hidden />,
                    onSelect: async () => {
                      const result = await openRepoInCursor(repo, toast, filePath);
                      if (result?.writable) setCursorDraftRepo(repo);
                      else if (result) {
                        setCursorDraftRepo(null);
                        toast.info("Opened a read-only Markdown copy; rich blocks prevent safe write-back.");
                      }
                    },
                  }))}
                />
              ) : null}
              {isNotes && cursorDraftRepo ? (
                <LaunchMenu
                  label="Apply Cursor changes"
                  icon={<FileCheck2 size={14} aria-hidden />}
                  buttonClassName="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                  disabled={status === "saving" || status === "error" || applyingCursorDraft}
                  items={[
                    {
                      id: "apply",
                      label: applyingCursorDraft ? "Applying…" : "Apply changes",
                      description: `Update this note from the ${cursorDraftRepo} Markdown copy`,
                      icon: applyingCursorDraft
                        ? <Loader2 size={14} className="animate-spin" aria-hidden />
                        : <FileCheck2 size={14} aria-hidden />,
                      onSelect: handleApplyCursorDraft,
                    },
                    {
                      id: "delete",
                      label: "Delete working copy",
                      description: "Keep the DevHub note and remove the persistent Markdown copy",
                      icon: <Trash2 size={14} aria-hidden />,
                      danger: true,
                      onSelect: handleDeleteCursorDraft,
                    },
                  ]}
                />
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
          Editing Markdown source directly so tables, diagrams, and formatting stay intact.
        </p>
      ) : null}

      {vaultId === "docs" && docBody !== null ? (
        <textarea
          value={docBody}
          onChange={(event) => handleDocChange(event.target.value)}
          aria-label="Markdown source"
          className="input w-full font-mono text-sm leading-relaxed resize-y"
          style={{ minHeight: "60vh" }}
          spellCheck={false}
        />
      ) : blocks !== null || isNew ? (
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
          description="Link a calendar event, PR, repo, task, or Jira issue to this note."
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
