"use client";

import type { ReactNode } from "react";
import { FileText, ListChecks, type LucideIcon } from "lucide-react";

export type NotesPanelView = "files" | "checklists";

const TABS: { id: NotesPanelView; label: string; Icon: LucideIcon }[] = [
  { id: "files", label: "Files", Icon: FileText },
  { id: "checklists", label: "Checklists", Icon: ListChecks },
];

export function NotesViewToggle({
  value,
  onChange,
  collapsed = false,
}: {
  value: NotesPanelView;
  onChange: (view: NotesPanelView) => void;
  /** Icon-only vertical tabs for the collapsed files rail. */
  collapsed?: boolean;
}) {
  return (
    <div
      className={collapsed ? "flex flex-col gap-1 w-full px-1" : "flex rounded-md p-0.5 gap-0.5"}
      role="tablist"
      aria-label="Notes view"
      style={collapsed ? undefined : { background: "var(--bg-elevated)" }}
    >
      {TABS.map(({ id, label, Icon }) => (
        <TabButton
          key={id}
          active={value === id}
          onClick={() => onChange(id)}
          icon={<Icon size={collapsed ? 14 : 12} aria-hidden />}
          label={label}
          collapsed={collapsed}
        />
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  collapsed = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  collapsed?: boolean;
}) {
  const activeColor = active ? "var(--text)" : collapsed ? "var(--text-muted)" : "var(--text-subtle)";
  const activeBg = active
    ? collapsed
      ? "var(--accent-dim)"
      : "var(--bg-surface)"
    : "transparent";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={
        collapsed
          ? "flex items-center justify-center rounded-md transition-colors"
          : "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors"
      }
      style={{
        height: collapsed ? 32 : undefined,
        width: collapsed ? "100%" : undefined,
        color: activeColor,
        background: activeBg,
        boxShadow: active
          ? collapsed
            ? "var(--shadow-inset-accent)"
            : "var(--shadow-raised)"
          : "none",
      }}
    >
      {icon}
      {!collapsed ? label : null}
    </button>
  );
}
