"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { PenTool, ExternalLink } from "lucide-react";
import { useBlockNoteEditor } from "@blocknote/react";
import { flattenTreeFiles } from "@/lib/tree-utils";
import {
  isDiagramStoragePath,
  toDiagramRoutePath,
  toNotesApiPath,
  hasVisibleDiagramShapes,
} from "@/lib/diagram-utils";

const TldrawThumbnail = dynamic(
  () => import("@/components/TldrawThumbnail").then((m) => m.TldrawThumbnail),
  { ssr: false, loading: () => <div className="skeleton w-full" style={{ height: 220 }} /> },
);

interface DiagramItem {
  path: string;
  name: string;
}

interface DiagramEmbedBlockViewProps {
  path: string;
  blockId: string;
}

export function DiagramEmbedBlockView({ path, blockId }: DiagramEmbedBlockViewProps) {
  const editor = useBlockNoteEditor();
  const editable = editor.isEditable;
  const [content, setContent] = useState<{ store?: Record<string, unknown> } | null | "loading">(
    "loading",
  );
  const [diagrams, setDiagrams] = useState<DiagramItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!path) {
        if (!cancelled) setContent(null);
        return;
      }
      if (!cancelled) setContent("loading");
      try {
        const r = await fetch(`/api/notes/${toNotesApiPath(path)}`);
        const json = r.ok ? await r.json() : null;
        if (!cancelled) setContent(json?.content ?? null);
      } catch {
        if (!cancelled) setContent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    if (path) return;
    let cancelled = false;
    fetch("/api/tree")
      .then((r) => (r.ok ? r.json() : []))
      .then((tree) => {
        if (cancelled) return;
        setDiagrams(
          flattenTreeFiles(tree)
            .filter((f) => isDiagramStoragePath(f.path))
            .map((f) => ({ path: f.path, name: f.name })),
        );
      })
      .catch(() => {
        if (!cancelled) setDiagrams([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const setPath = (next: string) => {
    const block = editor.document.find((b) => b.id === blockId);
    if (block) editor.updateBlock(block, { props: { path: next } });
  };

  if (!path) {
    return (
      <div className="card card-body my-1" contentEditable={false}>
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <PenTool size={14} aria-hidden /> Embed a diagram
        </div>
        {!editable ? (
          <p className="text-xs mt-2" style={{ color: "var(--text-subtle)" }}>
            No diagram selected.
          </p>
        ) : diagrams === null ? (
          <div className="skeleton h-8 mt-2" />
        ) : diagrams.length === 0 ? (
          <p className="text-xs mt-2" style={{ color: "var(--text-subtle)" }}>
            No diagrams yet - create one in Diagrams first.
          </p>
        ) : (
          <select
            className="input mt-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) setPath(e.target.value);
            }}
          >
            <option value="" disabled>
              Choose a diagram…
            </option>
            {diagrams.map((d) => (
              <option key={d.path} value={d.path}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  const name = path.split("/").pop()?.replace(/\.json$/, "") ?? path;
  const store = content && content !== "loading" ? content.store : undefined;
  const hasContent = !!store && hasVisibleDiagramShapes(store);

  return (
    <div className="card my-1 overflow-hidden" contentEditable={false}>
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-muted)" }}
      >
        <span className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>
          {name}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={toDiagramRoutePath(path)}
            className="hub-icon-btn"
            title="Open diagram"
            aria-label="Open diagram"
          >
            <ExternalLink size={12} aria-hidden />
          </Link>
          {editable && (
            <button
              type="button"
              className="btn btn-ghost text-xs"
              style={{ padding: "2px 6px" }}
              onClick={() => setPath("")}
            >
              Change
            </button>
          )}
        </div>
      </div>
      <div className="p-2">
        {content === "loading" ? (
          <div className="skeleton w-full" style={{ height: 220 }} />
        ) : hasContent && store ? (
          <div style={{ maxWidth: 360 }}>
            <TldrawThumbnail snapshot={store} />
          </div>
        ) : (
          <div
            className="flex items-center justify-center"
            style={{ height: 160, color: "var(--text-subtle)" }}
          >
            <PenTool size={24} aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
