"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ChevronRight,
  Folder,
  FolderInput,
  FolderPlus,
  PenTool,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InlineNoteRename } from "@/components/InlineNoteRename";
import { MoveDiagramModal, type MoveDiagramTarget } from "@/components/MoveDiagramModal";
import {
  collectDiagramFolderRelPaths,
  createEmptyDiagram,
  diagramBreadcrumbs,
  diagramFolderChildren,
  diagramFolderHref,
  diagramFolderStoragePath,
  extractDiagramsTree,
  hasVisibleDiagramShapes,
  normalizeDiagramFolder,
  splitDiagramEntries,
  stripDiagramsPrefix,
  toDiagramRoutePath,
  toNotesApiPath,
  type DiagramFile,
  type DiagramFolder,
  type DiagramTreeEntry,
} from "@/lib/diagram-utils";
import {
  createDiagramFolder,
  deleteDiagramFolder,
  moveDiagramEntry,
  renameDiagramFolder,
} from "@/lib/diagram-folder-actions";
import { renameNoteFile } from "@/lib/notes-path";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";

const TldrawThumbnail = dynamic(
  () => import("@/components/TldrawThumbnail").then((mod) => mod.TldrawThumbnail),
  { ssr: false, loading: () => <div className="w-full aspect-square rounded-[var(--radius-sm)]" style={{ background: "var(--bg-elevated)" }} /> },
);

function DiagramThumbnail({ data }: { data: unknown }) {
  const d = data as { store?: Record<string, unknown> } | null;
  const hasContent = !!d?.store && hasVisibleDiagramShapes(d.store);

  if (hasContent && d?.store) {
    return <TldrawThumbnail snapshot={d.store} />;
  }

  return (
    <div
      className="w-full aspect-square rounded flex items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <PenTool size={24} style={{ color: "var(--text-subtle)" }} />
    </div>
  );
}

type MoveCandidate = { storagePath: string; name: string; isDir: boolean };

export default function DiagramsIndex() {
  return (
    <Suspense fallback={<div className="page-wrapper" />}>
      <DiagramsIndexInner />
    </Suspense>
  );
}

function DiagramsIndexInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();

  const folder = normalizeDiagramFolder(searchParams.get("folder"));

  const [tree, setTree] = useState<DiagramTreeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const boot = useBootGate(loaded);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moving, setMoving] = useState<MoveCandidate | null>(null);

  const createInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    return fetch("/api/tree")
      .then((r) => (r.ok ? (r.json() as Promise<DiagramTreeEntry[]>) : []))
      .then((data) => setTree(Array.isArray(data) ? data : []))
      .catch(() => setTree([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);
  useEffect(() => {
    if (creatingFolder) folderInputRef.current?.focus();
  }, [creatingFolder]);

  const diagramsTree = useMemo(() => extractDiagramsTree(tree), [tree]);
  const entries = useMemo(
    () => diagramFolderChildren(diagramsTree, folder),
    [diagramsTree, folder],
  );
  const { folders, files } = useMemo(
    () => (entries ? splitDiagramEntries(entries) : { folders: [], files: [] }),
    [entries],
  );
  const crumbs = useMemo(() => diagramBreadcrumbs(folder), [folder]);
  const folderMissing = loaded && folder !== "" && entries === null;

  function goToFolder(relPath: string) {
    router.push(diagramFolderHref(relPath));
  }

  async function loadDiagramData(storagePath: string): Promise<unknown> {
    const r = await fetch(`/api/notes/${toNotesApiPath(storagePath)}`);
    if (!r.ok) return null;
    const json = await r.json();
    return json.content;
  }

  async function handleCreateDiagram() {
    const name = newName.trim() || `diagram-${Date.now()}`;
    const filePath = `${diagramFolderStoragePath(folder)}/${name}`;
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: createEmptyDiagram() }),
      });
      if (!r.ok) throw new Error("create failed");
      setCreating(false);
      setNewName("");
      router.push(toDiagramRoutePath(filePath));
    } catch {
      toast.error("Couldn't create diagram.");
    }
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    try {
      await createDiagramFolder(folder, name);
      toast.success("Folder created.");
      setCreatingFolder(false);
      setNewFolderName("");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create folder.");
    }
  }

  async function handleDeleteDiagram(file: DiagramFile) {
    const ok = await confirm({
      title: "Delete diagram",
      message: `Delete "${file.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    broadcastNoteAutosaveInvalidation(file.path);
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(file.path)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      toast.success("Diagram deleted.");
      await reload();
    } catch {
      toast.error("Couldn't delete diagram.");
    }
  }

  async function handleDeleteFolder(f: DiagramFolder) {
    const ok = await confirm({
      title: "Delete folder",
      message: `Delete folder "${f.name}" and every diagram inside it? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteDiagramFolder(f.storagePath);
      toast.success("Folder deleted.");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete folder.");
    }
  }

  const moveTargets: MoveDiagramTarget[] = useMemo(() => {
    if (!moving) return [];
    const movingRel = moving.isDir ? stripDiagramsPrefix(moving.storagePath) : "";
    const all = ["", ...collectDiagramFolderRelPaths(diagramsTree)];
    return all.map((relPath) => {
      const isCurrentParent = relPath === folder;
      const isSelfOrChild =
        moving.isDir && (relPath === movingRel || relPath.startsWith(`${movingRel}/`));
      return {
        relPath,
        label: relPath === "" ? "Diagrams (top level)" : relPath,
        disabled: isCurrentParent || isSelfOrChild,
      };
    });
  }, [moving, diagramsTree, folder]);

  async function handleMove(targetRel: string) {
    if (!moving) return;
    const candidate = moving;
    setMoving(null);
    try {
      await moveDiagramEntry(candidate.storagePath, targetRel, candidate.isDir);
      toast.success(`Moved to ${targetRel || "top level"}.`);
      await reload();
    } catch (err) {
      if (err instanceof Error && err.message === "unchanged") return;
      toast.error(err instanceof Error ? err.message : "Couldn't move item.");
    }
  }

  const isEmpty = folders.length === 0 && files.length === 0;
  // Show actions on tap (mobile) and on hover (desktop).
  const actionBtn =
    "hub-icon-btn reveal-on-hover transition-opacity";

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />

      <div className="page-header" style={{ alignItems: "flex-start" }}>
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={c.relPath || "__root__"} className="flex items-center gap-1 min-w-0">
                {i > 0 && (
                  <ChevronRight size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
                )}
                {isLast ? (
                  <span className="page-title truncate" style={{ color: "var(--text)" }}>
                    {c.name}
                  </span>
                ) : (
                  <Link
                    href={diagramFolderHref(c.relPath)}
                    className="text-sm truncate hover:underline"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {c.name}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(true);
              setNewFolderName("");
            }}
            className="btn btn-ghost text-xs"
          >
            <FolderPlus size={12} aria-hidden />
            New folder
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewName("");
            }}
            className="btn btn-primary text-xs"
          >
            <Plus size={12} aria-hidden />
            New diagram
          </button>
        </div>
      </div>

      {creatingFolder && (
        <div className="card p-4 mb-4 flex items-center gap-2">
          <Folder size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateFolder();
              if (e.key === "Escape") {
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
            placeholder="folder-name"
            className="input flex-1 text-sm"
            autoComplete="off"
          />
          <button type="button" onClick={() => void handleCreateFolder()} className="btn btn-primary text-xs">
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(false);
              setNewFolderName("");
            }}
            className="btn btn-ghost text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {creating && (
        <div className="card p-4 mb-4 flex items-center gap-2">
          <PenTool size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
          <input
            ref={createInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateDiagram();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="my-diagram"
            className="input flex-1 text-sm"
            autoComplete="off"
          />
          <button type="button" onClick={() => void handleCreateDiagram()} className="btn btn-primary text-xs">
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
            className="btn btn-ghost text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-3 flex flex-col gap-2">
              <div className="w-full aspect-square rounded-[var(--radius-sm)]" style={{ background: "var(--bg-elevated)" }} />
              <div className="h-3 w-2/3 rounded" style={{ background: "var(--bg-elevated)" }} />
            </div>
          ))}
        </div>
      ) : folderMissing ? (
        <EmptyState
          icon={<Folder size={32} />}
          title="Folder not found"
          subtitle={
            <Link href="/diagrams" className="btn btn-ghost text-xs mt-2">
              Back to all diagrams
            </Link>
          }
        />
      ) : isEmpty && !creating && !creatingFolder ? (
        <EmptyState
          icon={<PenTool size={32} />}
          title={folder ? "This folder is empty" : "No diagrams yet"}
          subtitle="Create a diagram or folder to get started."
        />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]">
          {folders.map((f) => (
            <div key={f.storagePath} className="card p-3 flex flex-col gap-2 group">
              <button
                type="button"
                onClick={() => goToFolder(f.relPath)}
                className="w-full aspect-square rounded flex items-center justify-center"
                style={{ background: "var(--bg)" }}
                title={`Open ${f.name}`}
                aria-label={`Open folder ${f.name}`}
              >
                <Folder size={36} style={{ color: "var(--text-subtle)" }} aria-hidden />
              </button>
              <div className="flex items-center gap-1">
                <InlineNoteRename
                  noteSlug={f.storagePath}
                  displayName={f.name}
                  active={false}
                  onRenamed={() => void reload()}
                  renameFile={renameDiagramFolder}
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: "var(--text)" }}
                  inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-xs"
                  title="Double-click to rename"
                />
                <button
                  type="button"
                  onClick={() => setMoving({ storagePath: f.storagePath, name: f.name, isDir: true })}
                  className={actionBtn}
                  title="Move"
                  aria-label={`Move ${f.name}`}
                >
                  <FolderInput size={11} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteFolder(f)}
                  className={actionBtn}
                  title="Delete folder"
                  aria-label={`Delete folder ${f.name}`}
                >
                  <Trash2 size={11} aria-hidden />
                </button>
              </div>
            </div>
          ))}

          {files.map((d) => (
            <div key={d.path} className="card p-3 flex flex-col gap-2 group">
              <Link href={toDiagramRoutePath(d.path)} className="block">
                <DiagramCardThumbnail storagePath={d.path} loader={loadDiagramData} />
              </Link>
              <div className="flex items-center gap-1">
                <InlineNoteRename
                  noteSlug={d.path}
                  displayName={d.name}
                  active={false}
                  onRenamed={() => void reload()}
                  renameFile={renameNoteFile}
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: "var(--text)" }}
                  inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-xs"
                  title="Double-click to rename"
                />
                <button
                  type="button"
                  onClick={() => setMoving({ storagePath: d.path, name: d.name, isDir: false })}
                  className={actionBtn}
                  title="Move"
                  aria-label={`Move ${d.name}`}
                >
                  <FolderInput size={11} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteDiagram(d)}
                  className={actionBtn}
                  title="Delete"
                  aria-label={`Delete ${d.name}`}
                >
                  <Trash2 size={11} aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {moving && (
        <MoveDiagramModal
          itemName={moving.name}
          targets={moveTargets}
          onMove={(rel) => void handleMove(rel)}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

function DiagramCardThumbnail({ storagePath, loader }: { storagePath: string; loader: (p: string) => Promise<unknown> }) {
  const [data, setData] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;
    loader(storagePath).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [storagePath, loader]);

  if (data == null) {
    return <div className="w-full aspect-square rounded-[var(--radius-sm)]" style={{ background: "var(--bg-elevated)" }} />;
  }

  return <DiagramThumbnail data={data} />;
}
