"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "@/lib/navigation";
import Link from "@/lib/navigation";
import { ArrowLeft, ChevronRight, PenTool, Trash2, Download } from "lucide-react";
import { CopyLocationButton } from "@/components/ui/CopyLocationButton";
import { ShareControls } from "@/components/ShareControls";
import { OneTimeShareButton } from "@/components/OneTimeShareButton";
import type { Editor } from "tldraw";
import { useToast } from "@/lib/hooks/use-toast";
import { InlineNoteRename } from "@/components/InlineNoteRename";
import {
  diagramBreadcrumbs,
  diagramFolderHref,
  diagramParentFolder,
  stripDiagramsPrefix,
  toDiagramRoutePath,
  toDiagramStoragePath,
  toNotesApiPath,
} from "../../../../../packages/shared/ui-lib/diagrams/utils";
import { renameNoteFile } from "@/lib/notes/path";
import { exportDiagramImage } from "@/lib/tldraw-export";
import { broadcastNoteAutosaveInvalidation } from "@/lib/notes/autosave-invalidation";
import { FetchError } from "@/components/ui/FetchError";
import { RouteLoading } from "@/components/ui/RouteLoading";

const TldrawCanvas = lazy(() => import("@/components/diagrams/TldrawCanvas").then((mod) => ({ default: mod.TldrawCanvas })));

export default function DiagramEditorPage({ path }: { path: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const routePath = path.join("/");
  const hasPath = routePath.length > 0;
  const filePath = toDiagramStoragePath(routePath);
  const [diagramData, setDiagramData] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(!hasPath);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loading = hasPath && !notFound && !loadError && diagramData === null;
  const editorRef = useRef<Editor | null>(null);
  const revisionRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  async function handleExport(format: "svg" | "png") {
    if (!editorRef.current) return;
    const name = routePath.split("/").pop() || "diagram";
    const ok = await exportDiagramImage(editorRef.current, format, name).catch(() => false);
    if (!ok) toast.error("Nothing to export yet.");
  }

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    fetch(`/api/notes/${toNotesApiPath(filePath)}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("Could not load diagram");
        return r.json();
      })
      .then((data) => {
        if (!cancelled && data === null) setNotFound(true);
        else if (!cancelled) {
          if (typeof data.revision !== "string") throw new Error("Diagram revision is unavailable");
          revisionRef.current = data.revision;
          setDiagramData(data.content);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, attempt]);

  function handleSave(data: unknown) {
    // The route is keyed per diagram; accepted saves must finish even after navigation.
    // Each snapshot must use the revision returned by the previous write.
    const queued = saveQueueRef.current.then(async () => {
      const response = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: data, expectedRevision: revisionRef.current }),
      });
      if (response.status === 409) throw new Error("Diagram changed elsewhere. Reload before editing again.");
      if (!response.ok) throw new Error("Could not save diagram");
      const saved = await response.json();
      if (typeof saved.revision !== "string") throw new Error("Saved diagram revision is unavailable");
      revisionRef.current = saved.revision;
    });
    saveQueueRef.current = queued.catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Couldn't save diagram.");
    });
  }

  async function handleDelete() {
    broadcastNoteAutosaveInvalidation(filePath);
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      toast.success("Diagram deleted.");
      router.push("/diagrams");
    } catch {
      toast.error("Couldn't delete diagram.");
    }
  }

  if (loading) {
    return <RouteLoading variant="block" />;
  }

  if (loadError) return <FetchError message="Could not load this diagram." onRetry={() => { setLoadError(false); setAttempt((value) => value + 1); }} />;

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <PenTool size={32} className="text-text-subtle" />
        <p className="text-sm text-text-subtle">
          Diagram not found.
        </p>
        <Link
          href="/diagrams"
          className="text-xs px-3 py-1.5 rounded-md text-accent"
        >
          Back to diagrams
        </Link>
      </div>
    );
  }

  const slug = stripDiagramsPrefix(filePath);
  const title = slug.split("/").pop() ?? "diagram";
  const parentFolder = diagramParentFolder(slug);
  const crumbs = diagramBreadcrumbs(parentFolder);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-2 px-4 py-2 shrink-0"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <Link
          href={diagramFolderHref(parentFolder)}
          className="rounded p-1 hover:bg-[var(--bg-elevated)]"
          title="Back to folder"
        >
          <ArrowLeft size={14} className="text-text-muted" />
        </Link>
        <PenTool size={14} className="text-text-subtle" aria-hidden />
        <nav
          className="hidden sm:flex items-center gap-1 min-w-0 shrink"
          aria-label="Breadcrumb"
        >
          {crumbs.map((c) => (
            <span key={c.relPath || "__root__"} className="flex items-center gap-1 min-w-0">
              <Link
                href={diagramFolderHref(c.relPath)}
                className="text-sm truncate hover:underline text-text-muted"
              >
                {c.name}
              </Link>
              <ChevronRight size={12} className="text-text-subtle" aria-hidden />
            </span>
          ))}
        </nav>
        <InlineNoteRename
          noteSlug={filePath}
          displayName={title}
          active={false}
          onRenamed={(newSlug) => router.replace(toDiagramRoutePath(newSlug))}
          renameFile={renameNoteFile}
          className="text-sm font-medium truncate flex-1 text-text"
          inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-sm font-medium"
          title="Double-click to rename"
        />
        <CopyLocationButton path={filePath} variant="button" size={12} />
        <ShareControls vaultId="notes" path={filePath} />
        <OneTimeShareButton vaultId="notes" path={filePath} />
        <button
          type="button"
          onClick={() => void handleExport("svg")}
          className="btn btn-ghost text-xs"
          style={{ padding: "2px 8px" }}
          title="Export as SVG"
        >
          <Download size={12} aria-hidden /> SVG
        </button>
        <button
          type="button"
          onClick={() => void handleExport("png")}
          className="btn btn-ghost text-xs"
          style={{ padding: "2px 8px" }}
          title="Export as PNG"
        >
          <Download size={12} aria-hidden /> PNG
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="hub-icon-btn"
          title="Delete diagram"
          aria-label="Delete diagram"
        >
          <Trash2
            size={14} className="text-danger"
            aria-hidden
          />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense fallback={<div className="skeleton h-full" aria-label="Loading diagram" />}><TldrawCanvas
          initialData={diagramData}
          onChange={handleSave}
          contentSlug={filePath}
          onEditorReady={(editor) => {
            editorRef.current = editor;
          }}
        /></Suspense>
      </div>
    </div>
  );
}
