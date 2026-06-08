"use client";

import { useState, useEffect, useCallback } from "react";
import { NotesOverlay } from "./NotesOverlay";
import { TasksOverlay } from "./TasksOverlay";
import { DiagramsOverlay } from "./DiagramsOverlay";
import { CommandPalette } from "./CommandPalette";
import { QuickCaptureModal } from "./QuickCaptureModal";

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

export function NotesOverlayProvider() {
  const panels = useExclusivePanels();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "k" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        panels.toggle("notes");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "t"
      ) {
        e.preventDefault();
        panels.toggle("tasks");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        panels.toggle("diagrams");
        return;
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "c"
      ) {
        e.preventDefault();
        setCaptureOpen(true);
        return;
      }
    }
    function onNotesToggle() {
      panels.toggle("notes");
    }
    function onTasksToggle() {
      panels.toggle("tasks");
    }
    function onDiagramsToggle() {
      panels.toggle("diagrams");
    }
    function onPaletteToggle() {
      setPaletteOpen((prev) => !prev);
    }
    function onCaptureOpen() {
      setCaptureOpen(true);
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
  }, [panels]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <>
      <CommandPalette
        key={paletteOpen ? "palette-open" : "palette-closed"}
        open={paletteOpen}
        onClose={closePalette}
      />
      <NotesOverlay open={panels.isOpen("notes")} onClose={panels.close} />
      <TasksOverlay open={panels.isOpen("tasks")} onClose={panels.close} />
      <DiagramsOverlay
        open={panels.isOpen("diagrams")}
        onClose={panels.close}
      />
      <QuickCaptureModal
        key={captureOpen ? "open" : "closed"}
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
      />
    </>
  );
}
