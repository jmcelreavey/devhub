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
  ClipboardCopy,
  Code2,
  FileCheck2,
  Flame,
  FolderInput,
  GitPullRequest,
  Link2,
  ListChecks,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Save,
  Trash2,
} from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/hooks/use-toast";
import { MoveVaultPathModal } from "@/components/MoveVaultPathModal";
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
import { CreateTasksFromDialog } from "@/components/notes/CreateTasksFromDialog";
import { ShareControls } from "@/components/ShareControls";
import { OneTimeShareButton } from "@/components/OneTimeShareButton";
import { VaultEditorNav } from "@/components/vault/VaultEditorNav";
import { VaultFileHistory } from "@/components/vault/VaultFileHistory";
import { getVaultClient } from "@/lib/vault/vault-client";
import type { VaultId } from "@/lib/vault/vault-client";
import { blocksToText, textToBlocks } from "@/lib/markdown-convert";
import { splitFrontmatterBlock } from "@/lib/docs/frontmatter";
import {
  firstHeadingFromBlocks,
  titleFromDocMarkdown,
  vaultDisplayTitle,
} from "@/lib/vault/display-title";
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
  getCursorNoteDraft,
  openPrInCursor,
  openRepoInCursor,
} from "@/lib/open-in-cursor-client";
import { parseGithubPrRef } from "@/lib/entity-links/parse-pr";
import {
  mergeEntityRefs,
  parseEntityLinksFromMarkdown,
  upsertEntityLinksInMarkdown,
} from "@/lib/entity-note";
import { useRouteHistoryLabel } from "@/lib/hooks/use-session-history";
import { isTaskNotePath, type TaskNoteOp } from "@shared/task-note/sections.ts";
import { TaskNoteVisual } from "@/components/notes/task-note/TaskNoteVisual";
import { useTaskNote } from "@/components/vault/use-task-note";
import { prepareTaskNoteBlocks } from "@/lib/notes/prepare-task-note";
import { applyTaskOpToBlocks, foldEditorChange } from "@/lib/notes/task-note-edit";
import { submitTaskNoteOperation } from "@/components/notes/task-note/task-note-operation";
import { repairNoteBlocks } from "@/lib/notes/repair-blocks";

export function VaultEditorPage({
  vault: vaultId,
  path: pathParts,
  notesAiConfigured,
  readHref,
  embedded = false,
  hideTaskQuestions = false,
}: {
  vault: VaultId;
  path: string[];
  notesAiConfigured?: boolean;
  /** Shown inside another page: no Back/Index bar, and the page's tab keeps its own name. */
  embedded?: boolean;
  hideTaskQuestions?: boolean;
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
  const [createTasksOpen, setCreateTasksOpen] = useState(false);
  const [oneTimeOpen, setOneTimeOpen] = useState(false);
  const [cursorDraft, setCursorDraft] = useState<{ notePath: string; repoName: string } | null>(null);
  const [applyingCursorDraft, setApplyingCursorDraft] = useState(false);
  const isNotes = vaultId === "notes";
  /** The whole note as last edited or received. Free-form edits of a task note update this without re-rendering. */
  const latestBlocksRef = useRef<DevHubPartialBlock[] | null>(null);
  /** Visual task notes ask the server to keep an agent's newer sections instead of answering 409 on save. */
  const mergeAgentSectionsRef = useRef(false);
  const statusRef = useRef<"idle" | "saving" | "saved" | "error">("idle");
  const cursorDraftRepo = cursorDraft?.notePath === filePath ? cursorDraft.repoName : null;
  const { data: allMasters } = useLive<MasterList[]>(
    isNotes && !isNew ? "/api/collections" : null,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Bumped on navigation/delete so debounced saves cannot write a prior note. */
  const saveGenerationRef = useRef(0);
  const sourceModifiedRef = useRef<number | null>(null);
  const [modifiedMs, setModifiedMs] = useState<number | null>(null);
  const setSourceModified = useCallback((ms: number | null) => {
    sourceModifiedRef.current = ms;
    setModifiedMs(ms);
  }, []);
  const {
    isTaskNote,
    sourceMode: taskSourceMode,
    view: taskNoteView,
    editorBlocks: editorInitialBlocks,
    toggleSource: toggleTaskSource,
  } = useTaskNote({
    isNotes,
    filePath,
    apiPrefix,
    paths,
    isNew,
    blocks,
    setBlocks,
    latestBlocksRef,
    sourceModifiedRef,
    setSourceModified,
    statusRef,
    setEditorEpoch,
  });
  const isNewRef = useRef(isNew);
  const allMastersRef = useRef(allMasters);
  const pendingLegacyMigrationRef = useRef(false);
  /**
   * Raw frontmatter block for the doc being edited; re-prepended on save.
   *
   * Mirrored into state because the title is derived from it during render, and
   * a ref read there would not re-derive when the doc changes. The ref stays the
   * save path's source of truth: saves are debounced, and a state read through a
   * stale closure would write back the previous doc's frontmatter. Same
   * state-plus-ref shape as isNewRef / allMastersRef above.
   */
  const docFrontmatterRef = useRef("");
  const [docFrontmatter, setDocFrontmatter] = useState("");

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
    setDocFrontmatter("");
    setIsNew(false);
    setEditorEpoch(0);
    fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 404) {
            setIsNew(true);
            setSourceModified(null);
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
          setSourceModified(typeof data.modified === "number" ? data.modified : null);
          if (vaultId === "docs") {
            const md = typeof data.content === "string" ? data.content : "";
            // Frontmatter is metadata, not prose. Hold it aside verbatim so the
            // editor never shows it and a save cannot mangle it.
            const { block, body } = splitFrontmatterBlock(md);
            docFrontmatterRef.current = block;
            setDocFrontmatter(block);
            setDocBody(body);
            setBlocks([]);
            return;
          }
          const content = Array.isArray(data.content) ? data.content : [];
          const raw = content as Parameters<typeof migrateNoteBlocks>[0];
          const masters = allMastersRef.current;
          pendingLegacyMigrationRef.current =
            !masters && noteBlocksHaveLegacyCollection(raw);
          const migrated = migrateNoteBlocks(raw, filePath, masters ?? []);
          // Repairs and the old task-note header fold happen in memory; nothing is written until the next save.
          const next = (
            vaultId === "notes" && isTaskNotePath(filePath) ? prepareTaskNoteBlocks(migrated) : repairNoteBlocks(migrated)
          ) as DevHubPartialBlock[];
          latestBlocksRef.current = next;
          setBlocks(next);
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
  }, [apiPrefix, filePath, paths, vaultId, setSourceModified]);

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

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const handleChange = useCallback(
    (newBlocks: DevHubPartialBlock[]) => {
      setCursorDraft(null);
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
            const expectedModified = method === "PUT" ? sourceModifiedRef.current : null;
            const r = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: newBlocks,
                expectedModified: expectedModified ?? undefined,
                mergeAgentSections: expectedModified !== null && mergeAgentSectionsRef.current ? true : undefined,
              }),
              signal: controller.signal,
            });
            if (!r.ok) throw new Error(await r.text());
            const saved = (await r.json()) as { modified?: number; merged?: DevHubPartialBlock[] };
            if (typeof saved.modified === "number") setSourceModified(saved.modified);
            if (saved.merged) {
              // An agent changed the sections while we were editing; the server kept theirs.
              latestBlocksRef.current = saved.merged;
              setBlocks(saved.merged);
            }
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
    [apiPrefix, cancelPendingSave, filePath, paths, router, setSourceModified],
  );

  /** Visual task notes edit only the free-form blocks; fold them back into the whole note. */
  const handleEditorChange = useCallback(
    (editorBlocks: DevHubPartialBlock[]) => {
      const whole = latestBlocksRef.current;
      const visual = isTaskNote && !taskSourceMode;
      const full = visual && whole ? foldEditorChange(whole, editorBlocks) : editorBlocks;
      latestBlocksRef.current = full;
      mergeAgentSectionsRef.current = visual;
      handleChange(full);
    },
    [handleChange, isTaskNote, taskSourceMode],
  );

  /** A section action from the visual note (answer a question, set a bug's status). */
  const applyTaskOp = useCallback(
    async (op: TaskNoteOp) => {
      const generation = saveGenerationRef.current;
      if (op.op === "resolve_question") {
        await submitTaskNoteOperation(filePath, op);
        if (!isCurrentNoteSaveGeneration(generation, saveGenerationRef.current)) return true;
      }
      const whole = latestBlocksRef.current;
      if (!whole) return false;
      try {
        const next = applyTaskOpToBlocks(whole, op);
        if (!next) return true;
        latestBlocksRef.current = next;
        setBlocks(next);
        mergeAgentSectionsRef.current = true;
        if (op.op !== "resolve_question") handleChange(next);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update the note.");
        return false;
      }
    },
    [filePath, handleChange, toast],
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
      message: `Delete "${label}"? You'll have a 10-second undo in the toast.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    // Snapshot the content BEFORE the delete lands — the Undo action puts it
    // back verbatim. If the snapshot fails we still delete, just without an
    // undo offer.
    let restoreContent: unknown = null;
    try {
      const snap = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`);
      if (snap.ok) {
        restoreContent = ((await snap.json()) as { content?: unknown }).content ?? null;
      }
    } catch {
      /* no undo then */
    }
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
      if (restoreContent != null) {
        toast.success(`Deleted "${label}"`, {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const restore = await fetch(`${apiPrefix}/${paths.apiPathFromSlug(filePath)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: restoreContent }),
                });
                if (!restore.ok) throw new Error(await restore.text());
                broadcastNoteAutosaveInvalidation(filePath);
                toast.success(`Restored "${label}"`);
                router.refresh();
              } catch (e) {
                console.error(e);
                toast.error(e instanceof Error ? e.message : `Could not restore ${label}.`);
              }
            },
          },
        });
      }
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
      setCursorDraft(null);
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
      latestBlocksRef.current = newBlocks;
      setBlocks(newBlocks);
      if (typeof saved.modified === "number") setSourceModified(saved.modified);
      setEditorEpoch((n) => n + 1);
      setStatus("saved");
      setLastSaved(new Date());
      void mutate("/api/share");
    },
    [apiPrefix, cancelPendingSave, filePath, paths, setSourceModified],
  );

  const handleMoved = useCallback(
    (newPath: string) => {
      const oldPath = filePath;
      const undo = async () => {
        try {
          await paths.renameFile(newPath, oldPath.split("/").pop() ?? oldPath);
          broadcastNoteAutosaveInvalidation(newPath);
          toast.success("Moved back.");
          router.push(paths.pageHref(oldPath));
          router.refresh();
        } catch (e) {
          console.error(e);
          toast.error(e instanceof Error ? e.message : "Could not move back.");
        }
      };
      toast.success("Moved.", {
        duration: 10_000,
        action: { label: "Undo", onClick: () => void undo() },
      });
      router.push(paths.pageHref(newPath));
      router.refresh();
    },
    [filePath, paths, router, toast],
  );

  const fileName = pathParts[pathParts.length - 1] ?? filePath;
  const contentTitle = useMemo(() => {
    if (vaultId === "docs") {
      return titleFromDocMarkdown(`${docFrontmatter}${docBody ?? ""}`) ?? undefined;
    }
    if (blocks?.length) return firstHeadingFromBlocks(blocks) ?? undefined;
    return undefined;
  }, [blocks, docBody, docFrontmatter, vaultId]);
  const { displayTitle, fromContent } = vaultDisplayTitle(fileName, contentTitle);
  // Only pass content-derived titles; truncation of machine filenames is NotePageTitle's job.
  const headerDisplayTitle = fromContent ? displayTitle : undefined;
  const headerLabel = displayTitle;
  useRouteHistoryLabel(embedded ? null : headerDisplayTitle);

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
      const migrated = migrateNoteBlocks(content as Parameters<typeof migrateNoteBlocks>[0], filePath, allMasters ?? []);
      const next = (isTaskNote ? prepareTaskNoteBlocks(migrated) : repairNoteBlocks(migrated)) as DevHubPartialBlock[];
      latestBlocksRef.current = next;
      setBlocks(next);
      if ("modified" in result && typeof result.modified === "number") {
        setSourceModified(result.modified);
      }
      setEditorEpoch((value) => value + 1);
      setStatus("saved");
      setError(null);
      setLastSaved(new Date());
      setCursorDraft(null);
      void mutate("/api/share");
      toast.success("Applied Cursor changes");
    } finally {
      setApplyingCursorDraft(false);
    }
  }, [allMasters, cursorDraftRepo, filePath, invalidatePendingSave, isTaskNote, status, toast, setSourceModified]);

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
      setCursorDraft(null);
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
  const linkedPrs = useMemo(() => {
    if (!blocks?.length) return [];
    const seen = new Set<string>();
    const prs: { repo: string; number: number; label: string }[] = [];
    for (const ref of parseEntityLinksFromMarkdown(blocksToText(blocks))) {
      if (ref.kind !== "pr") continue;
      const parsed = parseGithubPrRef(ref.href || ref.id);
      if (!parsed) continue;
      const key = `${parsed.repo}#${parsed.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      prs.push({ ...parsed, label: ref.label || key });
    }
    return prs;
  }, [blocks]);

  useEffect(() => {
    if (!isNotes || isNew || linkedRepos.length === 0) return;
    let cancelled = false;
    void Promise.all(linkedRepos.map(async (repo) => ({ repo, draft: await getCursorNoteDraft(repo, filePath) })))
      .then((drafts) => {
        const match = drafts.find(({ draft }) => draft?.writable);
        if (!cancelled) setCursorDraft(match ? { notePath: filePath, repoName: match.repo } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, isNew, isNotes, linkedRepos]);

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

  const noteEditor = (
    <BlockNoteEditor
      className={isNotes ? "note-editor" : undefined}
      key={`${filePath}:${editorEpoch}:${taskSourceMode ? "source" : "view"}`}
      initialContent={editorInitialBlocks && editorInitialBlocks.length > 0 ? editorInitialBlocks : undefined}
      onChange={isTaskNote ? handleEditorChange : handleChange}
      tagLines={isTaskNote}
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
      style={{ minHeight: taskNoteView && !taskSourceMode ? "160px" : "60vh" }}
    />
  );

  return (
    <div className="page-wrapper">
      {embedded ? null : <VaultEditorNav vaultId={vaultId} />}
      <div
        className="page-header"
        style={{ marginBottom: "12px", alignItems: "flex-start" }}
      >
        <div className="min-w-0 flex-1 overflow-hidden">
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
                  title={fileName}
                  displayTitle={headerDisplayTitle}
                  nested
                  isNew={isNew}
                  onRenamed={handleRenamed}
                  renameFile={isNotes ? guardedRenameFile : undefined}
                />
              ) : (
                <span className="text-lg font-semibold text-text break-words">
                  {headerLabel}
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
                  title={fileName}
                  displayTitle={headerDisplayTitle}
                  nested
                  isNew={isNew}
                  onRenamed={handleRenamed}
                  renameFile={isNotes ? guardedRenameFile : undefined}
                />
              ) : (
                <span className="text-lg font-semibold text-text break-words">
                  {headerLabel}
                </span>
              )}
            </nav>
          )}
        </div>
        <div className="relative flex flex-nowrap items-center justify-end gap-2 shrink-0">
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
          {!isNew && filePath ? (
            <VaultFileHistory vaultId={vaultId} path={filePath} modifiedMs={modifiedMs} />
          ) : null}
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
              {isNotes && blocks ? (
                <>
<button
                    type="button"
                    className="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                    title="Add link"
                    aria-label="Add link"
                    onClick={() => {
                      window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
                      setLinkOpen(true);
                    }}
                  >
                    <Link2 size={14} aria-hidden />
                    Link
                  </button>
                </>
              ) : null}
              <LaunchMenu
                label="More"
                icon={<MoreHorizontal size={14} aria-hidden />}
                buttonClassName="btn btn-ghost text-xs flex items-center gap-1 shrink-0"
                disabled={status === "saving" || deleting}
                sections={["Open", "Work", "Copy and share", "Organise"]}
                items={[
                  {
                    id: "one-time",
                    section: "Copy and share",
                    label: "One-time link",
                    description: "Burn-after-reading PrivateBin share",
                    icon: <Flame size={14} aria-hidden />,
                    onSelect: () => setOneTimeOpen(true),
                  },
                  ...(isNotes && blocks
                    ? [
                        {
                          id: "spawn-tasks-from-plan",
                          section: "Work",
                          label: "Spawn tasks from plan",
                          description: "Create Jira tickets and DevHub tasks",
                          icon: <ListTodo size={14} aria-hidden />,
                          onSelect: () => {
                            window.dispatchEvent(new Event("devhub:dismiss-hovertips"));
                            setCreateTasksOpen(true);
                          },
                        },
                      ]
                    : []),
                  ...(isNotes && linkedRepos.length > 0
                    ? linkedRepos.map((repo) => ({
                        id: `open-cursor-${repo}`,
                        section: "Open",
                        label:
                          linkedRepos.length === 1
                            ? "Open with Cursor"
                            : `Open with Cursor · ${repo}`,
                        description: `Open this note with ${repo}`,
                        icon: <Code2 size={14} aria-hidden />,
                        onSelect: async () => {
                          const result = await openRepoInCursor(repo, toast, filePath);
                          if (result?.writable) {
                            setCursorDraft({ notePath: filePath, repoName: repo });
                          } else if (result) {
                            setCursorDraft(null);
                            toast.info(
                              "Opened a read-only Markdown copy; rich blocks prevent safe write-back.",
                            );
                          }
                        },
                      }))
                    : []),
                  ...(isNotes && linkedPrs.length > 0
                    ? linkedPrs.map((pr) => ({
                        id: `open-pr-cursor-${pr.repo}-${pr.number}`,
                        section: "Open",
                        label:
                          linkedPrs.length === 1
                            ? "Open PR in Cursor"
                            : `Open PR in Cursor · ${pr.label}`,
                        description: `Check out ${pr.label}; stash if dirty`,
                        icon: <GitPullRequest size={14} aria-hidden />,
                        onSelect: async () => {
                          const result = await openPrInCursor(pr.repo, pr.number, toast, filePath);
                          if (result?.writable) {
                            setCursorDraft({
                              notePath: filePath,
                              repoName: result.localRepoName,
                            });
                          } else if (result) {
                            setCursorDraft(null);
                            toast.info(
                              "Opened a read-only Markdown copy; rich blocks prevent safe write-back.",
                            );
                          }
                        },
                      }))
                    : []),
                  ...(isNotes && cursorDraftRepo
                    ? [
                        {
                          id: "apply-cursor",
                          section: "Work",
                          label: applyingCursorDraft ? "Applying…" : "Apply Cursor changes",
                          description: `Update this note from the ${cursorDraftRepo} Markdown copy`,
                          icon: applyingCursorDraft ? (
                            <Loader2 size={14} className="animate-spin" aria-hidden />
                          ) : (
                            <FileCheck2 size={14} aria-hidden />
                          ),
                          onSelect: () => {
                            void handleApplyCursorDraft();
                          },
                        },
                        {
                          id: "delete-cursor",
                          label: "Delete working copy",
                          description:
                            "Remove the Markdown copy; keep this note",
                          icon: <Trash2 size={14} aria-hidden />,
                          danger: true,
                          onSelect: () => {
                            void handleDeleteCursorDraft();
                          },
                        },
                      ]
                    : []),
                  ...(isNotes && !folderMaster
                    ? [
                        {
                          id: "create-checklist",
                          section: "Work",
                          label: "Create checklist",
                          description: `For ${createMasterScope || "this note"}`,
                          icon: <ListChecks size={14} aria-hidden />,
                          onSelect: () => {
                            router.push(
                              notesChecklistsHref({
                                notePath: filePath,
                                scope: createMasterScope ?? "",
                              }),
                            );
                          },
                        },
                      ]
                    : []),
                  {
                    id: "copy-location",
                    section: "Copy and share",
                    label: "Copy location",
                    description: filePath,
                    icon: <ClipboardCopy size={14} aria-hidden />,
                    onSelect: async () => {
                      try {
                        await copyTextToClipboard(filePath);
                        toast.success("Location copied");
                      } catch {
                        toast.error("Could not copy to clipboard.");
                      }
                    },
                  },
                  {
                    id: "move",
                    section: "Organise",
                    label: "Move",
                    description: `Move ${headerLabel}`,
                    icon: <FolderInput size={14} aria-hidden />,
                    onSelect: () => setMoveModalOpen(true),
                  },
                  {
                    id: "delete",
                    label: deleting ? "Deleting…" : "Delete",
                    description: `Delete ${headerLabel}`,
                    icon: <Trash2 size={14} aria-hidden />,
                    danger: true,
                    onSelect: () => {
                      void handleDelete();
                    },
                  },
                ]}
              />
              <OneTimeShareButton
                vaultId={vaultId}
                path={filePath}
                hideTrigger
                open={oneTimeOpen}
                onOpenChange={setOneTimeOpen}
              />
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
        taskNoteView ? (
          <TaskNoteVisual
            view={taskNoteView}
            sourceMode={taskSourceMode}
            onToggleSource={toggleTaskSource}
            onOp={applyTaskOp}
            hideQuestions={hideTaskQuestions}
          >
            {noteEditor}
          </TaskNoteVisual>
        ) : (
          noteEditor
        )
      ) : null}

      {isNotes && !isNew && blocks ? (
        <EntityRelationsPanel
          notePath={filePath}
          blocks={blocks}
          onAddLink={() => setLinkOpen(true)}
        />
      ) : null}

      {isNotes && !isNew && blocks ? (
        <CreateTasksFromDialog
          open={createTasksOpen}
          notePath={filePath}
          noteMarkdown={blocksToText(blocks)}
          onClose={() => setCreateTasksOpen(false)}
        />
      ) : null}

      {isNotes && !isNew && blocks ? (
        <EntityLinkDialog
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          defaultKind="calendar"
          description="Link a calendar event, PR, note, diagram, repo, task, or Jira issue to this note."
          existing={linkOpen ? parseEntityLinksFromMarkdown(blocksToText(blocks)) : undefined}
          onSave={async (refs) => {
            const md = blocksToText(blocks);
            const nextRefs = mergeEntityRefs(parseEntityLinksFromMarkdown(md), refs);
            const nextMd = upsertEntityLinksInMarkdown(md, nextRefs);
            const nextBlocks = textToBlocks(nextMd) as DevHubPartialBlock[];
            await persistBlocksImmediate(nextBlocks);
            toast.success(refs.length === 1 ? "Link added" : `${refs.length} links added`);
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
