"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

/**
 * All five surfaces here are keyboard-summoned and invisible at boot, but this
 * provider lives in the root layout — so importing them statically put every
 * one of them in the layout chunk, on every route.
 *
 * NotesOverlay was the expensive one by a wide margin: it imports
 * BlockNoteEditor, which pulls @blocknote/mantine + @blocknote/xl-ai +
 * ProseMirror (~900 KB of chunk). That was loading on /datadog.
 *
 * `ssr: false` throughout — none of these can be visible on first paint, so
 * there is nothing to pre-render.
 */
const NotesOverlay = dynamic(
  () => import("./NotesOverlay").then((m) => ({ default: m.NotesOverlay })),
  { ssr: false },
);
const TasksOverlay = dynamic(
  () => import("@/components/tasks/TasksOverlay").then((m) => ({ default: m.TasksOverlay })),
  { ssr: false },
);
const DiagramsOverlay = dynamic(
  () => import("@/components/diagrams/DiagramsOverlay").then((m) => ({ default: m.DiagramsOverlay })),
  { ssr: false },
);
const CommandPalette = dynamic(
  () => import("@/components/shell/CommandPalette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);
const QuickCaptureModal = dynamic(
  () => import("@/components/tasks/QuickCaptureModal").then((m) => ({ default: m.QuickCaptureModal })),
  { ssr: false },
);

type PanelKind = "notes" | "tasks" | "diagrams";

function useExclusivePanels() {
  const [openPanel, setOpenPanel] = useState<PanelKind | null>(null);

  const toggle = useCallback((panel: PanelKind) => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const close = useCallback(() => setOpenPanel(null), []);

  const isOpen = useCallback(
    (panel: PanelKind) => openPanel === panel,
    [openPanel],
  );

  return { toggle, close, isOpen };
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
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "k" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        togglePanel("notes");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "t"
      ) {
        e.preventDefault();
        togglePanel("tasks");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        togglePanel("diagrams");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "c"
      ) {
        e.preventDefault();
        openCapture();
        return;
      }
    }
    function onNotesToggle() {
      togglePanel("notes");
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
    window.addEventListener("devhub:tasks-toggle", onTasksToggle);
    window.addEventListener("devhub:diagrams-toggle", onDiagramsToggle);
    window.addEventListener("devhub:palette-toggle", onPaletteToggle);
    window.addEventListener("devhub:capture-open", onCaptureOpen);
    return () => {
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("devhub:notes-toggle", onNotesToggle);
      window.removeEventListener("devhub:tasks-toggle", onTasksToggle);
      window.removeEventListener("devhub:diagrams-toggle", onDiagramsToggle);
      window.removeEventListener("devhub:palette-toggle", onPaletteToggle);
      window.removeEventListener("devhub:capture-open", onCaptureOpen);
    };
  }, [togglePanel, togglePalette, openCapture]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <>
      {hasSummoned("palette") && (
        <CommandPalette
          key={paletteOpen ? "palette-open" : "palette-closed"}
          open={paletteOpen}
          onClose={closePalette}
        />
      )}
      {hasSummoned("notes") && (
        <NotesOverlay open={panels.isOpen("notes")} onClose={panels.close} />
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
    </>
  );
}
