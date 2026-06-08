"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  PenTool,
  Search,
  RefreshCw,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { HoverTip } from "@/components/HoverTip";
import {
  createEmptyDiagram,
  createUniqueDiagramStoragePath,
  isDiagramStoragePath,
  toDiagramRoutePath,
  toNotesApiPath,
} from "@/lib/diagram-utils";
import { flattenTreeFiles } from "@/lib/tree-utils";
import { SidePanel } from "./SidePanel";

interface DiagramsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function DiagramsOverlay({ open, onClose }: DiagramsOverlayProps) {
  const [query, setQuery] = useState("");
  const [recentDiagrams, setRecentDiagrams] = useState<
    { path: string; name: string }[]
  >([]);
  const [contentPaths, setContentPaths] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const contentSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const toast = useToast();

  const loadDiagrams = useCallback((): Promise<void> => {
    return fetch("/api/tree")
      .then((r) => r.json())
      .then((tree) => {
        const allFiles = flattenTreeFiles(tree);
        const diagrams = allFiles.filter((f) => isDiagramStoragePath(f.path));
        setRecentDiagrams(diagrams);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (open) void loadDiagrams();
  }, [open, loadDiagrams]);

  useEffect(() => {
    if (contentSearchTimer.current) clearTimeout(contentSearchTimer.current);
    if (query.trim().length < 2) {
      setContentPaths(new Set()); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    contentSearchTimer.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}&prefix=diagrams/`)
        .then((r) => r.json())
        .then((data) => {
          const paths = new Set<string>(
            (data.files ?? []).map((f: { path: string }) => f.path),
          );
          setContentPaths(paths);
        })
        .catch(() => {});
    }, 300);
    return () => {
      if (contentSearchTimer.current) clearTimeout(contentSearchTimer.current);
    };
  }, [query]);

  const handleClose = useCallback(() => {
    setQuery("");
    setContentPaths(new Set());
    onClose();
  }, [onClose]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadDiagrams();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadDiagrams]);

  const createDiagram = useCallback(async () => {
    const filePath = createUniqueDiagramStoragePath();
    try {
      const r = await fetch(`/api/notes/${toNotesApiPath(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: createEmptyDiagram(),
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error ?? "Could not create diagram");
      }
      toast.success("Diagram created.");
      handleClose();
      router.push(toDiagramRoutePath(filePath));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't create diagram.",
      );
    }
  }, [handleClose, router, toast]);

  const openDiagram = useCallback(
    (diagramPath: string) => {
      handleClose();
      router.push(toDiagramRoutePath(diagramPath));
    },
    [handleClose, router],
  );

  const q = query.toLowerCase();
  const filteredDiagrams = q
    ? recentDiagrams.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.path.toLowerCase().includes(q) ||
          contentPaths.has(d.path),
      )
    : recentDiagrams;

  return (
    <SidePanel
      open={open}
      onClose={handleClose}
      storageKey="diagrams-panel-width"
      ariaLabel="Diagrams"
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <Search
          size={14}
          style={{ color: "var(--text-muted)", flexShrink: 0 }}
          aria-hidden
        />
        <label htmlFor="diagrams-search-input" className="sr-only">
          Search diagrams
        </label>
        <input
          id="diagrams-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search diagrams…"
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "var(--text)" }}
        />
        <HoverTip label={isRefreshing ? "Refreshing…" : "Refresh diagrams list"}>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            aria-label="Refresh diagrams list"
            className="shrink-0 rounded p-0.5 disabled:opacity-50 hover:bg-[var(--bg-elevated)]"
          >
            <RefreshCw
              size={14}
              className={isRefreshing ? "animate-spin" : ""}
              style={{ color: "var(--text-muted)" }}
              aria-hidden
            />
          </button>
        </HoverTip>
        <button
          type="button"
          onClick={() => void createDiagram()}
          className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-elevated)]"
          title="New diagram"
          aria-label="New diagram"
        >
          <Plus size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close diagrams panel"
        >
          <X size={16} style={{ color: "var(--text-muted)" }} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loaded && !q ? (
          <div className="p-3 flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-9 rounded-md" />
            ))}
          </div>
        ) : filteredDiagrams.length === 0 ? (
          <div className="p-4 text-center">
            <p
              className="text-xs mb-3"
              style={{ color: "var(--text-subtle)" }}
            >
              {q
                ? `No results for "${query}"`
                : "No diagrams yet. Create one to get started."}
            </p>
            {!q && (
              <button
                type="button"
                onClick={() => void createDiagram()}
                className="text-xs px-3 py-1.5 rounded-md"
                style={{
                  background: "var(--accent-dim)",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                }}
              >
                + New diagram
              </button>
            )}
          </div>
        ) : (
          <div className="p-2">
            {filteredDiagrams.map((d) => (
              <button
                key={d.path}
                className="w-full text-left px-3 py-2 rounded text-xs hover:bg-[var(--bg-elevated)] flex items-center gap-2"
                onClick={() => openDiagram(d.path)}
              >
                <PenTool
                  size={12}
                  style={{ color: "var(--text-subtle)" }}
                />
                <span style={{ color: "var(--text)" }}>{d.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
