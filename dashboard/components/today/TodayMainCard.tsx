"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, ListTodo, MoreHorizontal, Trash2 } from "lucide-react";
import { TaskList } from "@/components/TaskList";
import { TodayCollapseButton } from "@/components/TodayCollapseButton";
import { StandupCopyButton } from "@/components/StandupCopyButton";
import type { DevHubPartialBlock } from "@/lib/blocknote-schema";
import { SaveStatusPill } from "./SaveStatusPill";
import { TabButton } from "./TabButton";

const BlockNoteEditor = dynamic(
  () => import("@/components/BlockNoteEditor").then((m) => m.BlockNoteEditor),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <div className="skeleton h-7 w-[30%]" />
        <div className="skeleton h-4 w-[90%]" />
        <div className="skeleton h-4 w-[70%]" />
      </div>
    ),
  },
);

export type TodayTab = "tasks" | "notes";

export function TodayMainCard({
  tab,
  onTabChange,
  mainCollapsed,
  onToggleCollapsed,
  mainCollapsedSummary,
  status,
  tasksTotal,
  tasksDone,
  onClearNote,
  blocks,
  noteEditorKey,
  todayPath,
  onNoteChange,
}: {
  tab: TodayTab;
  onTabChange: (tab: TodayTab) => void;
  mainCollapsed: boolean;
  onToggleCollapsed: () => void;
  mainCollapsedSummary: string;
  status: "idle" | "saving" | "saved" | "error";
  tasksTotal: number;
  tasksDone: number;
  onClearNote: () => void;
  blocks: DevHubPartialBlock[] | null;
  noteEditorKey: number;
  todayPath: string;
  onNoteChange: (blocks: DevHubPartialBlock[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <section
      className="hub-card"
      data-collapsed={mainCollapsed ? "true" : undefined}
      aria-label={tab === "tasks" ? "Today's tasks" : "Today's notes"}
    >
      <header className="hub-card-head today-grid-drag-handle">
        <div className="hub-tabs" role="tablist" aria-label="Today view">
          <TabButton
            active={tab === "tasks"}
            onClick={() => onTabChange("tasks")}
            icon={<ListTodo size={13} aria-hidden />}
            label="Tasks"
          />
          <TabButton
            active={tab === "notes"}
            onClick={() => onTabChange("notes")}
            icon={<FileText size={13} aria-hidden />}
            label="Notes"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {mainCollapsed ? <span className="today-collapsed-summary">{mainCollapsedSummary}</span> : null}
          <SaveStatusPill status={status} />
          {tab === "tasks" && tasksTotal > 0 && (
            <span className="hub-card-count">
              <span key={tasksDone} className="count-tick">
                {tasksDone}
              </span>
              /{tasksTotal} done
            </span>
          )}
          <div className="relative today-grid-drag-cancel" ref={menuRef}>
            <button
              type="button"
              className="today-collapse-toggle"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal size={13} aria-hidden />
            </button>
            <div
              role="menu"
              aria-label="Card actions"
              className="today-actions-menu pop-soft"
              style={{ display: menuOpen ? undefined : "none" }}
              onClick={() => setMenuOpen(false)}
            >
              <StandupCopyButton variant="compact" />
              {tab === "notes" && !mainCollapsed && (
                <button
                  type="button"
                  className="btn btn-ghost justify-start px-2.5 py-1 text-xs"
                  onClick={onClearNote}
                  title="Clear today's note"
                >
                  <Trash2 size={12} aria-hidden /> Clear note
                </button>
              )}
            </div>
          </div>
          <TodayCollapseButton
            collapsed={mainCollapsed}
            label="Tasks and notes"
            onToggle={onToggleCollapsed}
          />
        </div>
      </header>

      {!mainCollapsed ? (
        <div key={tab} className="hub-card-body fade-rise">
          {tab === "tasks" && <TaskList />}
          {tab === "notes" &&
            (blocks ? (
              <BlockNoteEditor
                key={noteEditorKey}
                initialContent={blocks}
                onChange={onNoteChange}
                vaultId="notes"
                contentSlug={todayPath}
                style={{ minHeight: "50vh" }}
              />
            ) : (
              <div className="space-y-3">
                <div className="skeleton h-7 w-[30%]" />
                <div className="skeleton h-4 w-[90%]" />
                <div className="skeleton h-4 w-[70%]" />
                <div className="skeleton h-7 w-[25%]" />
                <div className="skeleton h-4 w-[80%]" />
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}

/** Re-export for callers that want the dynamic loading spinner shape. */
export type TodayMainCardSlot = ReactNode;
