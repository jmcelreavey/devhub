"use client";

import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { appShortcutFromEvent, repoPageOwnsShortcut } from "@/lib/navigation/app-shortcuts";
import { NOTES_OPEN_PATH_EVENT, type NotesOpenPathDetail } from "@/lib/notes/open-in-panel";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import paletteStyles from "@/components/shell/CommandPalette.module.css";

/**
 * All five surfaces here are keyboard-summoned and invisible at boot, but this
 * provider lives in the root layout — so importing them statically put every
 * one of them in the layout chunk, on every route.
 *
 * NotesOverlay was the expensive one by a wide margin: it imports
 * BlockNoteEditor, which pulls @blocknote/mantine + @blocknote/xl-ai +
 * ProseMirror (~900 KB of chunk). That was loading on /datadog.
 *
 */
const NotesOverlay = lazy(() => import("./NotesOverlay").then((module) => ({ default: module.NotesOverlay })));
const TasksOverlay = lazy(() => import("@/components/tasks/TasksOverlay").then((module) => ({ default: module.TasksOverlay })));
const DiagramsOverlay = lazy(() => import("@/components/diagrams/DiagramsOverlay").then((module) => ({ default: module.DiagramsOverlay })));
const CommandPalette = lazy(async () => {
  const started = Date.now();
  const module = await import("@/components/shell/CommandPalette");
  const elapsed = Date.now() - started;
  if (elapsed >= 350 && elapsed < 600) await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
  return { default: module.CommandPalette };
});
const QuickCaptureModal = lazy(() => import("@/components/tasks/QuickCaptureModal").then((module) => ({ default: module.QuickCaptureModal })));

type PanelKind = "notes" | "tasks" | "diagrams";

function PaletteLoading({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setVisible(true), 350);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open || !visible) return null;
  return <div className={`palette-overlay ${paletteStyles.overlay}`} onClick={onClose}>
    <div className={`palette-panel ${paletteStyles.panel}`} role="status" aria-label="Loading command palette" onClick={(event) => event.stopPropagation()}>
      <div className={paletteStyles.search}><span className="skeleton" style={{ width: "60%", height: 18 }} /></div>
      <div className={paletteStyles.scopes}><span className="skeleton" style={{ width: "70%", height: 32 }} /></div>
      <div className={paletteStyles.loading}><SkeletonRows count={3} height={52} variant="list" /></div>
    </div>
  </div>;
}

function useExclusivePanels() {
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);

  const toggle = useCallback((panel: PanelKind) => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const open = useCallback((panel: PanelKind) => setOpenPanel(panel), []);

  const close = useCallback(() => setOpenPanel(null), []);

  const isOpen = useCallback(
    (panel: PanelKind) => openPanel === panel,
    [openPanel],
  );

  return { toggle, open, close, isOpen };
}

/**
 * Tracks which surfaces have been summoned at least once this session.
 *
 * A lazily-imported surface must not mount before it is first needed (that
 * would defeat the split), but once mounted it stays mounted — the chunk is
 * already paid for, and keeping it around preserves scroll position, draft
 * text and editor state between opens, exactly as the static version did.
 */
function useSummoned() {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());

  const summon = useCallback((key: string) => {
    setSeen((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  return { summon, hasSummoned: (key: string) => seen.has(key) };
}

export function NotesOverlayProvider() {
  const panels = useExclusivePanels();
  const { summon, hasSummoned } = useSummoned();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  /** Bumped per "open today's note" request so the overlay reacts even when already open. */
  const [todayNoteRequest, setTodayNoteRequest] = useState(0);
  /** Bumped per "open this note" request (task notes from Implement, task menus, inbox). */
  const [notePathRequest, setNotePathRequest] = useState<{ path: string; id: number } | null>(null);

  /** Toggling a panel is also what mounts it the first time. */
  const togglePanel = useCallback(
    (panel: PanelKind) => {
      summon(panel);
      panels.toggle(panel);
    },
    [panels, summon],
  );

  const togglePalette = useCallback(() => {
    summon("palette");
    setPaletteOpen((prev) => !prev);
  }, [summon]);

  const openCapture = useCallback(() => {
    summon("capture");
    setCaptureOpen(true);
  }, [summon]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Visible `/repos/:name` owns ⌘Enter / ⌘⇧T (upstart / repo terminal).
      if (repoPageOwnsShortcut(e, window.location.pathname)) return;
      const shortcut = appShortcutFromEvent(e);
      if (!shortcut) return;
      e.preventDefault();
      if (shortcut === "palette") togglePalette();
      else if (shortcut === "notes") togglePanel("notes");
      else if (shortcut === "tasks") togglePanel("tasks");
      else if (shortcut === "diagrams") togglePanel("diagrams");
      else if (shortcut === "capture") openCapture();
    }
    function onNotesToggle() {
      togglePanel("notes");
    }
    function onNotesOpenToday() {
      summon("notes");
      panels.open("notes");
      setTodayNoteRequest((n) => n + 1);
    }
    function onNotesOpenPath(event: Event) {
      const path = (event as CustomEvent<NotesOpenPathDetail>).detail?.path;
      if (!path) return;
      summon("notes");
      panels.open("notes");
      setNotePathRequest((prev) => ({ path, id: (prev?.id ?? 0) + 1 }));
    }
    function onTasksToggle() {
      togglePanel("tasks");
    }
    function onDiagramsToggle() {
      togglePanel("diagrams");
    }
    function onPaletteToggle() {
      togglePalette();
    }
    function onCaptureOpen() {
      openCapture();
    }

    document.addEventListener("keydown", handleKey);
    window.addEventListener("devhub:notes-toggle", onNotesToggle);
    window.addEventListener("devhub:notes-open-today", onNotesOpenToday);
    window.addEventListener(NOTES_OPEN_PATH_EVENT, onNotesOpenPath);
    window.addEventListener("devhub:tasks-toggle", onTasksToggle);
    window.addEventListener("devhub:diagrams-toggle", onDiagramsToggle);
    window.addEventListener("devhub:palette-toggle", onPaletteToggle);
    window.addEventListener("devhub:capture-open", onCaptureOpen);
    return () => {
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("devhub:notes-toggle", onNotesToggle);
      window.removeEventListener("devhub:notes-open-today", onNotesOpenToday);
      window.removeEventListener(NOTES_OPEN_PATH_EVENT, onNotesOpenPath);
      window.removeEventListener("devhub:tasks-toggle", onTasksToggle);
      window.removeEventListener("devhub:diagrams-toggle", onDiagramsToggle);
      window.removeEventListener("devhub:palette-toggle", onPaletteToggle);
      window.removeEventListener("devhub:capture-open", onCaptureOpen);
    };
  }, [togglePanel, togglePalette, openCapture, panels, summon]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <Suspense fallback={null}>
      {hasSummoned("palette") && (
        <Suspense fallback={<PaletteLoading open={paletteOpen} onClose={closePalette} />}>
          <CommandPalette
            key={paletteOpen ? "palette-open" : "palette-closed"}
            open={paletteOpen}
            onClose={closePalette}
          />
        </Suspense>
      )}
      {hasSummoned("notes") && (
        <NotesOverlay
          open={panels.isOpen("notes")}
          onClose={panels.close}
          todayNoteRequest={todayNoteRequest}
          notePathRequest={notePathRequest}
        />
      )}
      {hasSummoned("tasks") && (
        <TasksOverlay open={panels.isOpen("tasks")} onClose={panels.close} />
      )}
      {hasSummoned("diagrams") && (
        <DiagramsOverlay open={panels.isOpen("diagrams")} onClose={panels.close} />
      )}
      {hasSummoned("capture") && (
        <QuickCaptureModal
          key={captureOpen ? "open" : "closed"}
          open={captureOpen}
          onClose={() => setCaptureOpen(false)}
        />
      )}
    </Suspense>
  );
}
