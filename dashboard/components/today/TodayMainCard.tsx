"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, ListTodo, MoreHorizontal, Trash2 } from "lucide-react";
import { TaskList } from "@/components/tasks/TaskList";
import { TodayCollapseButton } from "@/components/today/TodayCollapseButton";
import { StandupCopyButton } from "@/components/StandupCopyButton";
import type { DevHubPartialBlock } from "@/lib/blocknote/schema";
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenuStyle({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

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
          <div className="relative today-grid-drag-cancel">
            <button
              ref={triggerRef}
              type="button"
              className="today-collapse-toggle"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              onClick={() => { updateMenuPosition(); setMenuOpen((o) => !o); }}
            >
              <MoreHorizontal size={13} aria-hidden />
            </button>
            {menuOpen && menuStyle && typeof document !== "undefined" ? createPortal(
              <div ref={menuRef} role="menu" aria-label="Card actions" className="today-actions-menu pop-soft" data-portal style={menuStyle}>
              <StandupCopyButton variant="compact" />
              {tab === "notes" && !mainCollapsed && (
                <button
                  type="button"
                  className="launch-menu-item"
                  role="menuitem"
                  onClick={onClearNote}
                  title="Clear today's note"
                >
                  <span className="launch-menu-icon">
                    <Trash2 size={12} aria-hidden />
                  </span>
                  <span className="launch-menu-copy">
                    <span className="launch-menu-label">Clear note</span>
                  </span>
                </button>
              )}
              </div>, document.body) : null}
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
                style={{ minHeight: 0, height: "100%", flex: 1 }}
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
