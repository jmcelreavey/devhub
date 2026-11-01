"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import Link from "@/lib/navigation";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  PenTool,
  Plus,
} from "lucide-react";
import { useRouter, useSearchParams } from "@/lib/navigation";
import { useToast } from "@/lib/hooks/use-toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { FetchError } from "@/components/ui/FetchError";
import { MoveDiagramModal, type MoveDiagramTarget } from "@/components/diagrams/MoveDiagramModal";
import { DiagramFileCard, DiagramFolderCard } from "@/components/diagrams/DiagramCards";
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
  type DiagramTreeEntry,
} from "../../../../packages/shared/ui-lib/diagrams/utils";
import {
  createDiagramFolder,
  moveDiagramEntry,
} from "@/lib/diagrams/folder-actions";
import { BootScreen, useBootGate } from "@/components/ui/BootScreen";
import { DiagramsLandingPage } from "@/components/diagrams/DiagramsLandingPage";
import {
  diagramBrowseModelFromTree,
  writeLastDiagramFolder,
} from "@/lib/diagrams/diagram-browse";

const TldrawThumbnail = lazy(() => import("@/components/diagrams/TldrawThumbnail").then((mod) => ({ default: mod.TldrawThumbnail })));

function DiagramThumbnail({ data }: { data: unknown }) {
  const d = data as { store?: Record<string, unknown> } | null;
  const hasContent = !!d?.store && hasVisibleDiagramShapes(d.store);

  if (hasContent && d?.store) {
    return <Suspense fallback={<div className="w-full aspect-square skeleton rounded-[var(--radius-sm)]" />}><TldrawThumbnail snapshot={d.store} /></Suspense>;
  }

  return (
    <div
      className="w-full aspect-square rounded flex items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <PenTool size={24} className="text-text-subtle" />
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
  const folder = normalizeDiagramFolder(searchParams.get("folder"));

  const { tree, loadError, reload } = useOutletContext<{
    tree: DiagramTreeEntry[];
    loadError: boolean;
    reload: () => Promise<DiagramTreeEntry[] | undefined>;
  }>();
  const boot = useBootGate(true);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moving, setMoving] = useState<MoveCandidate | null>(null);

  const createInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

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
  const folderMissing = folder !== "" && entries === null;

  const browseModel = useMemo(
    () => diagramBrowseModelFromTree(diagramsTree),
    [diagramsTree],
  );

  useEffect(() => {
    if (folder) writeLastDiagramFolder(folder);
  }, [folder]);

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
      // Undo = move back to the original parent folder.
      const originalRel = stripDiagramsPrefix(candidate.storagePath);
      const originalParent = originalRel.includes("/")
        ? originalRel.slice(0, originalRel.lastIndexOf("/"))
        : "";
      const name = candidate.storagePath.split("/").pop() ?? candidate.storagePath;
      toast.success(`Moved to ${targetRel || "top level"}.`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            void moveDiagramEntry(
              `${diagramFolderStoragePath(targetRel)}/${name}`,
              originalParent,
              candidate.isDir,
            )
              .then(() => reload())
              .catch(() => toast.error("Couldn't move it back."));
          },
        },
      });
      await reload();
    } catch (err) {
      if (err instanceof Error && err.message === "unchanged") return;
      toast.error(err instanceof Error ? err.message : "Couldn't move item.");
    }
  }

  const isEmpty = folders.length === 0 && files.length === 0;

  if (!folder && !folderMissing) {
    return (
      <div className="page-wrapper">
        <BootScreen state={boot} />
        {loadError && <FetchError message="Could not refresh diagrams. Showing the last loaded view." onRetry={() => { void reload(); }} />}
        {creatingFolder ? (
          <div className="card p-4 mb-4 flex items-center gap-2">
            <Folder size={14} className="text-text-subtle" aria-hidden />
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
              aria-label="Folder name"
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
        ) : null}
        {creating ? (
          <div className="card p-4 mb-4 flex items-center gap-2">
            <PenTool size={14} className="text-text-subtle" aria-hidden />
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
              aria-label="Diagram name"
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
        ) : null}
        <DiagramsLandingPage
          areas={browseModel.areas}
          recent={browseModel.recent}
          total={browseModel.total}
          onNewDiagram={() => {
            setCreating(true);
            setNewName("");
          }}
          onNewFolder={() => {
            setCreatingFolder(true);
            setNewFolderName("");
          }}
          onChanged={() => void reload()}
        />
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

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      {loadError && <FetchError message="Could not refresh diagrams. Showing the last loaded view." onRetry={() => { void reload(); }} />}

      <div className="page-header" style={{ alignItems: "flex-start" }}>
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={c.relPath || "__root__"} className="flex items-center gap-1 min-w-0">
                {i > 0 && (
                  <ChevronRight size={14} className="text-text-subtle" aria-hidden />
                )}
                {isLast ? (
                  <span className="page-title truncate text-text">
                    {c.name}
                  </span>
                ) : (
                  <Link
                    href={diagramFolderHref(c.relPath)}
                    className="text-sm truncate hover:underline text-text-muted"
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
          <Folder size={14} className="text-text-subtle" aria-hidden />
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
            aria-label="Folder name"
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
          <PenTool size={14} className="text-text-subtle" aria-hidden />
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
            aria-label="Diagram name"
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

      {folderMissing ? (
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
            <DiagramFolderCard
              key={f.storagePath}
              folder={f}
              onOpen={() => goToFolder(f.relPath)}
              onChanged={() => void reload()}
              onMove={() => setMoving({ storagePath: f.storagePath, name: f.name, isDir: true })}
            />
          ))}

          {files.map((d) => (
            <DiagramFileCard
              key={d.path}
              file={d}
              onChanged={() => void reload()}
              onMove={() => setMoving({ storagePath: d.path, name: d.name, isDir: false })}
              thumbnail={<DiagramCardThumbnail storagePath={d.path} loader={loadDiagramData} />}
            />
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
