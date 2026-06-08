"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PenTool, Plus, Trash2, Pencil } from "lucide-react";
import { flattenTreeFiles } from "@/lib/tree-utils";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import {
  createEmptyDiagram,
  hasVisibleDiagramShapes,
  isDiagramStoragePath,
  toDiagramRoutePath,
  toNotesApiPath,
  DIAGRAMS_DIR,
} from "@/lib/diagram-utils";
import { broadcastNoteAutosaveInvalidation } from "@/lib/note-autosave-invalidation";

interface DiagramItem {
  path: string;
  name: string;
}

const TldrawThumbnail = dynamic(
  () => import("@/components/TldrawThumbnail").then((mod) => mod.TldrawThumbnail),
  { ssr: false, loading: () => <div className="skeleton w-full aspect-square" /> },
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

export default function DiagramsIndex() {
  const [diagrams, setDiagrams] = useState<DiagramItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/tree")
      .then((r) => (r.ok ? r.json() : []))
      .then((tree) => {
        const allFiles = flattenTreeFiles(tree);
        setDiagrams(
          allFiles
            .filter((f) => isDiagramStoragePath(f.path))
            .map((f) => ({ path: f.path, name: f.name.replace(/\.json$/, "") })),
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (creating && createInputRef.current) createInputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    if (renamingPath && renameInputRef.current) renameInputRef.current.focus();
  }, [renamingPath]);

  async function loadDiagramData(storagePath: string): Promise<unknown> {
    const r = await fetch(`/api/notes/${toNotesApiPath(storagePath)}`);
    if (!r.ok) return null;
    const json = await r.json();
    return json.content;
  }

  async function handleCreate() {
    const name = newName.trim() || `diagram-${Date.now()}`;
    const filePath = `${DIAGRAMS_DIR}/${name}`;
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: createEmptyDiagram() }),
      });
      if (!r.ok) throw new Error("Could not create diagram");
      toast.success("Diagram created.");
      setCreating(false);
      setNewName("");
      router.push(toDiagramRoutePath(filePath));
    } catch {
      toast.error("Couldn't create diagram.");
    }
  }

  async function handleDelete(path: string, name: string) {
    const ok = await confirm({
      title: "Delete diagram",
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    broadcastNoteAutosaveInvalidation(path);
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(path)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      setDiagrams((prev) => prev.filter((d) => d.path !== path));
      toast.success("Diagram deleted.");
    } catch {
      toast.error("Couldn't delete diagram.");
    }
  }

  async function handleRename(oldPath: string) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldPath.slice(DIAGRAMS_DIR.length + 1)) {
      setRenamingPath(null);
      return;
    }
    const newPath = `${DIAGRAMS_DIR}/${trimmed}`;
    broadcastNoteAutosaveInvalidation(oldPath);
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(oldPath)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath }),
      });
      if (!r.ok) throw new Error("Rename failed");
      setDiagrams((prev) =>
        prev.map((d) =>
          d.path === oldPath ? { path: newPath, name: trimmed } : d,
        ),
      );
      setRenamingPath(null);
      toast.success("Diagram renamed.");
    } catch {
      toast.error("Couldn't rename diagram.");
    }
  }

  function startRename(item: DiagramItem) {
    setRenamingPath(item.path);
    setRenameValue(item.name);
  }

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="page-title">Diagrams</div>
        <button
          type="button"
          onClick={() => { setCreating(true); setNewName(""); }}
          className="btn btn-primary text-xs"
        >
          <Plus size={12} aria-hidden />
          New diagram
        </button>
      </div>

      {creating && (
        <div className="card p-4 mb-4 flex items-center gap-2">
          <input
            ref={createInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
            placeholder="my-diagram"
            className="input flex-1 text-sm"
            autoComplete="off"
          />
          <button type="button" onClick={() => void handleCreate()} className="btn btn-primary text-xs">
            Create
          </button>
          <button type="button" onClick={() => { setCreating(false); setNewName(""); }} className="btn btn-ghost text-xs">
            Cancel
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-3 flex flex-col gap-2">
              <div className="skeleton w-full aspect-square" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : diagrams.length === 0 && !creating ? (
        <EmptyState
          icon={<PenTool size={32} />}
          title="No diagrams yet"
          subtitle="Create one to get started."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {diagrams.map((d) => (
            <div key={d.path} className="card p-3 flex flex-col gap-2 group">
              <Link href={toDiagramRoutePath(d.path)} className="block">
                <DiagramCardThumbnail storagePath={d.path} loader={loadDiagramData} />
              </Link>

              {renamingPath === d.path ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleRename(d.path); if (e.key === "Escape") setRenamingPath(null); }}
                    className="input flex-1 text-xs py-1"
                  />
                  <button type="button" onClick={() => void handleRename(d.path)} className="btn btn-primary text-xs px-2 py-1">
                    <Pencil size={11} aria-hidden />
                  </button>
                  <button type="button" onClick={() => setRenamingPath(null)} className="btn btn-ghost text-xs px-2 py-1">
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium truncate flex-1" style={{ color: "var(--text)" }}>
                    {d.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => startRename(d)}
                    className="hub-icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rename"
                    aria-label={`Rename ${d.name}`}
                  >
                    <Pencil size={11} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(d.path, d.name)}
                    className="hub-icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete"
                    aria-label={`Delete ${d.name}`}
                  >
                    <Trash2 size={11} aria-hidden />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
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
    return <div className="skeleton w-full aspect-square" />;
  }

  return <DiagramThumbnail data={data} />;
}
