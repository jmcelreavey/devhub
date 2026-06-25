"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, PenTool, Trash2, Download } from "lucide-react";
import dynamic from "next/dynamic";
import type { Editor } from "tldraw";
import { useToast } from "@/lib/use-toast";
import { InlineNoteRename } from "@/components/InlineNoteRename";
import {
  diagramBreadcrumbs,
  diagramFolderHref,
  diagramParentFolder,
  stripDiagramsPrefix,
  toDiagramRoutePath,
  toDiagramStoragePath,
  toNotesApiPath,
} from "@/lib/diagram-utils";
import { renameNoteFile } from "@/lib/notes-path";
import { exportDiagramImage } from "@/lib/tldraw-export";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

const TldrawCanvas = dynamic(
  () =>
    import("@/components/TldrawCanvas").then((mod) => ({
      default: mod.TldrawCanvas,
    })),
  { ssr: false },
);

export default function DiagramEditorPage() {
  const params = useParams<{ path: string[] }>();
  const router = useRouter();
  const toast = useToast();
  const routePath = (params.path ?? []).map((p) => decodeURIComponent(p)).join("/");
  const hasPath = routePath.length > 0;
  const filePath = toDiagramStoragePath(routePath);
  const [diagramData, setDiagramData] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(!hasPath);
  const loading = hasPath && !notFound && diagramData === null;
  const editorRef = useRef<Editor | null>(null);

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
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setDiagramData(data.content);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => { cancelled = true; };
  }, [filePath]);

  function handleSave(data: unknown) {
    fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: data }),
    }).catch(() => {
      toast.error("Couldn't save diagram.");
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
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--text-subtle)" }}
      >
        <span className="text-sm">Loading diagram…</span>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <PenTool size={32} style={{ color: "var(--text-subtle)" }} />
        <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
          Diagram not found.
        </p>
        <Link
          href="/diagrams"
          className="text-xs px-3 py-1.5 rounded-md"
          style={{ color: "var(--accent)" }}
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
          <ArrowLeft size={14} style={{ color: "var(--text-muted)" }} />
        </Link>
        <PenTool size={14} style={{ color: "var(--text-subtle)" }} aria-hidden />
        <nav
          className="hidden sm:flex items-center gap-1 min-w-0 shrink"
          aria-label="Breadcrumb"
        >
          {crumbs.map((c) => (
            <span key={c.relPath || "__root__"} className="flex items-center gap-1 min-w-0">
              <Link
                href={diagramFolderHref(c.relPath)}
                className="text-sm truncate hover:underline"
                style={{ color: "var(--text-muted)" }}
              >
                {c.name}
              </Link>
              <ChevronRight size={12} style={{ color: "var(--text-subtle)" }} aria-hidden />
            </span>
          ))}
        </nav>
        <InlineNoteRename
          noteSlug={filePath}
          displayName={title}
          active={false}
          onRenamed={(newSlug) => router.replace(toDiagramRoutePath(newSlug))}
          renameFile={renameNoteFile}
          className="text-sm font-medium truncate flex-1"
          style={{ color: "var(--text)" }}
          inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none text-sm font-medium"
          title="Double-click to rename"
        />
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
            size={14}
            style={{ color: "var(--danger)" }}
            aria-hidden
          />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <TldrawCanvas
          initialData={diagramData}
          onChange={handleSave}
          contentSlug={filePath}
          onEditorReady={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}
