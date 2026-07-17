"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { BlockNoteEditor } from "./BlockNoteEditor";
import {
  X,
  ExternalLink,
  FileText,
  RefreshCw,
  Plus,
  Check,
  ClipboardCopy,
} from "lucide-react";
import { NewNotePathModal } from "./NewNotePathModal";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isDiagramStoragePath } from "@/lib/diagram-utils";
import { isMobileViewport } from "@/lib/use-is-mobile";
import { notesApiPathFromSlug, notesPageHref } from "@/lib/notes-path";
import { SidePanel } from "./SidePanel";
import { FileTree } from "./FileTree";
import { SearchInput } from "./SearchInput";
import { HoverTip } from "@/components/HoverTip";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";

interface SearchResult {
  path: string;
  line: number;
  text: string;
}

interface FileGroup {
  path: string;
  matches: SearchResult[];
  score: number;
}

interface NoteOverlayProps {
  open: boolean;
  onClose: () => void;
}

function CopyRefButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    copyTextToClipboard(path).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      title={`Copy reference: ${path}`}
      className="shrink-0 rounded p-0.5 reveal-on-hover transition-opacity"
      style={{ color: copied ? "var(--success)" : "var(--text-subtle)" }}
      onClick={handleClick}
    >
      {copied ? (
        <Check size={11} aria-hidden />
      ) : (
        <ClipboardCopy size={11} aria-hidden />
      )}
      <span className="sr-only">Copy reference</span>
    </button>
  );
}

export function NotesOverlay({ open, onClose }: NoteOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeNote, setActiveNote] = useState<{
    path: string;
    blocks: DevHubPartialBlock[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fileTreeKey, setFileTreeKey] = useState(0);
  const router = useRouter();
  const toast = useToast();
  const [newNoteModalOpen, setNewNoteModalOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery(""); // eslint-disable-line react-hooks/set-state-in-effect
      setResults([]);
      setActiveNote(null);
      return;
    }

    setFileTreeKey((k) => k + 1);
  }, [open]);

  const handleRefresh = useCallback(async () => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setIsRefreshing(true);
    try {
      setFileTreeKey((k) => k + 1);
      const q = query.trim();
      if (q) {
        setSearching(true);
        try {
          const r = await fetch(
            `/api/search?q=${encodeURIComponent(q)}`,
          );
          const data = await r.json();
          const flat = (data.files ?? []).flatMap((f: FileGroup) =>
            f.matches.map((m) => ({ ...m, path: f.path })),
          );
          setResults(flat.filter((m: SearchResult) => !isDiagramStoragePath(m.path)));
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results on empty query
      setResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data) => {
          const flat = (data.files ?? []).flatMap((f: FileGroup) =>
            f.matches.map((m: SearchResult) => ({ ...m, path: f.path })),
          );
          setResults(flat.filter((m: SearchResult) => !isDiagramStoragePath(m.path)));
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }, [query]);

  const openNote = useCallback(
    (notePath: string) => {
      const cleanPath = notePath.replace(/\.json$/, "");
      // Phones use the full-page editor; the notes layout files panel handles browsing.
      if (isMobileViewport()) {
        onClose();
        router.push(notesPageHref(cleanPath));
        return;
      }
      fetch(`/api/notes/${notesApiPathFromSlug(cleanPath)}`)
        .then((r) => {
          if (!r.ok) throw new Error("Not found");
          return r.json();
        })
        .then((data) => {
          setActiveNote({ path: cleanPath, blocks: data.content });
        })
        .catch((e) => {
          console.error("open note:", e);
          toast.error("Couldn't open note.");
        });
    },
    [toast, onClose, router],
  );

  const handleSave = useCallback(
    (blocks: DevHubPartialBlock[]) => {
      if (!activeNote) return;
      fetch(`/api/notes/${notesApiPathFromSlug(activeNote.path)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: blocks }),
      }).catch((e) => {
        console.error("save note:", e);
        toast.error("Couldn't save note.");
      });
    },
    [activeNote, toast],
  );

  const openFullPage = useCallback(() => {
    if (activeNote) {
      onClose();
      router.push(`/notes/${activeNote.path}`);
    }
  }, [activeNote, onClose, router]);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      storageKey="notes-panel-width"
      defaultWidth={440}
      ariaLabel={activeNote ? "Note editor" : "Notes search"}
    >
      <div
        className="flex items-center gap-2 px-4 py-3 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        {activeNote ? (
          <>
            <button
              type="button"
              onClick={() => setActiveNote(null)}
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
              aria-label="Back to search"
            >
              &larr; Back
            </button>
            <span
              className="text-sm font-medium truncate flex-1"
              style={{ color: "var(--text)" }}
            >
              {activeNote.path.split("/").pop()}
            </span>
            <button
              type="button"
              onClick={() => setNewNoteModalOpen(true)}
              className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-elevated)]"
              title="New note"
              aria-label="New note"
            >
              <Plus
                size={14}
                style={{ color: "var(--text-muted)" }}
                aria-hidden
              />
            </button>
            <button
              type="button"
              onClick={openFullPage}
              title="Open in full page"
              aria-label="Open in full page"
            >
              <ExternalLink
                size={14}
                style={{ color: "var(--text-muted)" }}
                aria-hidden
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notes panel"
            >
              <X
                size={16}
                style={{ color: "var(--text-muted)" }}
                aria-hidden
              />
            </button>
          </>
        ) : (
          <>
            <label htmlFor="notes-search-input" className="sr-only">
              Search notes
            </label>
            <SearchInput
              id="notes-search-input"
              value={query}
              onChange={setQuery}
              placeholder="Search notes…"
              autoFocus
              isLoading={searching}
              wrapperClassName="min-w-0 flex-1"
              inputClassName="h-8 text-sm"
            />
            <HoverTip label={isRefreshing ? "Refreshing…" : "Refresh notes list"}>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                aria-label="Refresh notes list"
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
              onClick={() => setNewNoteModalOpen(true)}
              className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-elevated)]"
              title="New note"
              aria-label="New note"
            >
              <Plus
                size={14}
                style={{ color: "var(--text-muted)" }}
                aria-hidden
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close notes panel"
            >
              <X
                size={16}
                style={{ color: "var(--text-muted)" }}
                aria-hidden
              />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {activeNote ? (
          <div className="p-2">
            <BlockNoteEditor
              key={activeNote.path}
              initialContent={activeNote.blocks}
              onChange={handleSave}
              vaultId="notes"
              contentSlug={activeNote.path}
            />
          </div>
        ) : query.trim() ? (
          <div className="p-2">
            {results.length === 0 && !searching && (
              <p
                className="text-xs px-2 py-4 text-center"
                style={{ color: "var(--text-subtle)" }}
              >
                No results for &ldquo;{query}&rdquo;
              </p>
            )}
            {results.map((r, i) => {
              const refPath = r.path.replace(/\.json$/, "");
              return (
                <div
                  key={`${r.path}-${r.line}-${i}`}
                  className="group w-full text-left px-3 py-2 rounded text-xs hover:bg-[var(--bg-elevated)] flex items-start gap-2"
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 flex items-start gap-2 text-left"
                    onClick={() => openNote(r.path)}
                  >
                    <FileText
                      size={12}
                      style={{
                        color: "var(--text-subtle)",
                        marginTop: "2px",
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-medium truncate"
                        style={{ color: "var(--text)" }}
                      >
                        {refPath}
                      </div>
                      <div
                        className="truncate"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {r.text}
                      </div>
                    </div>
                  </button>
                  <CopyRefButton path={refPath} />
                </div>
              );
            })}
          </div>
        ) : (
          <FileTree key={fileTreeKey} onSelect={openNote} />
        )}
      </div>

      {newNoteModalOpen && (
        <NewNotePathModal
          onClose={() => setNewNoteModalOpen(false)}
          onCreated={(cleanPath) => {
            openNote(cleanPath);
            setFileTreeKey((k) => k + 1);
          }}
        />
      )}
    </SidePanel>
  );
}
