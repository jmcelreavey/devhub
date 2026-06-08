"use client";

import type { ReactNode } from "react";
import { GripVertical, Link, Link2, Unlink, X } from "lucide-react";
import { HoverTip } from "@/components/HoverTip";

export interface ChecklistRowProps {
  label: string;
  checked: boolean;
  linked?: boolean;
  brokenLink?: boolean;
  renamedInMaster?: boolean;
  masterLabel?: string;
  masterName?: string;
  disabled?: boolean;
  draggable?: boolean;
  onToggle: () => void;
  onPromote?: () => void;
  onDetach?: () => void;
  onAcceptMasterLabel?: () => void;
  onKeepLocalLabel?: () => void;
  onDelete?: () => void;
}

/** Borderless icon control — avoids btn-ghost box when SVG is the only child. */
function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      contentEditable={false}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 transition-colors hover:bg-[var(--bg-overlay)]"
      style={{ color: "var(--text-muted)" }}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function ChecklistRow({
  label,
  checked,
  linked,
  brokenLink,
  renamedInMaster,
  masterLabel,
  masterName,
  disabled,
  draggable,
  onToggle,
  onPromote,
  onDetach,
  onAcceptMasterLabel,
  onKeepLocalLabel,
  onDelete,
}: ChecklistRowProps) {
  const labelColor = brokenLink ? "var(--text-subtle)" : checked ? "var(--text-subtle)" : "var(--text)";

  return (
    <div
      contentEditable={false}
      className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--bg-overlay)]"
      style={{ color: labelColor }}
    >
      {draggable ? (
        <GripVertical
          size={14}
          aria-hidden
          className="opacity-0 group-hover:opacity-100"
          style={{ color: "var(--text-subtle)", cursor: "grab" }}
        />
      ) : null}
      <button
        type="button"
        contentEditable={false}
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[11px] transition-colors"
        style={{
          borderColor: checked ? "var(--accent)" : "var(--border)",
          background: checked ? "var(--accent)" : "transparent",
          color: checked ? "#fff" : "var(--text-subtle)",
        }}
        onClick={onToggle}
      >
        {checked ? "✓" : ""}
      </button>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${brokenLink ? "line-through" : ""} ${
          checked && !brokenLink ? "line-through opacity-70" : ""
        }`}
      >
        {label}
      </span>
      {linked && !brokenLink ? (
        <HoverTip label={masterName ? `Linked to ${masterName}` : "Linked to master list"}>
          <Link2
            size={14}
            style={{ color: "var(--accent)" }}
            strokeWidth={2}
            fill="currentColor"
            aria-hidden
          />
        </HoverTip>
      ) : null}
      {renamedInMaster && onAcceptMasterLabel && onKeepLocalLabel ? (
        <div className="flex shrink-0 items-center gap-1">
          <HoverTip
            label={
              masterLabel
                ? `Master: "${masterLabel}" — use this name or keep "${label}" unlinked`
                : "Name changed in master list"
            }
          >
            <button
              type="button"
              contentEditable={false}
              className="badge badge-muted text-[10px] transition-colors hover:bg-[var(--bg-overlay)]"
              onClick={onAcceptMasterLabel}
            >
              renamed
            </button>
          </HoverTip>
          <RowIconButton label={`Use master name: ${masterLabel ?? "updated name"}`} onClick={onAcceptMasterLabel}>
            <span className="text-[10px] font-medium" style={{ color: "var(--accent)" }}>
              sync
            </span>
          </RowIconButton>
          <RowIconButton label={`Keep "${label}" and unlink`} onClick={onKeepLocalLabel}>
            <Unlink size={12} strokeWidth={2} aria-hidden />
          </RowIconButton>
        </div>
      ) : renamedInMaster ? (
        <HoverTip label={masterName ? `Renamed in ${masterName}` : "Renamed in master"}>
          <span className="badge badge-muted text-[10px]">renamed</span>
        </HoverTip>
      ) : null}
      {brokenLink && onDetach ? (
        <HoverTip label="Detach from master (keep as note-only)">
          <RowIconButton label={`Detach ${label}`} onClick={onDetach}>
            <Unlink size={14} strokeWidth={2} aria-hidden />
          </RowIconButton>
        </HoverTip>
      ) : null}
      {!linked && onPromote ? (
        <HoverTip label={masterName ? `Link to ${masterName}` : "Link to master"}>
          <RowIconButton label={`Link ${label} to master`} onClick={onPromote}>
            <Link size={14} strokeWidth={2} style={{ color: "var(--accent)" }} aria-hidden />
          </RowIconButton>
        </HoverTip>
      ) : null}
      {onDelete ? (
        <HoverTip label="Remove">
          <RowIconButton label={`Remove ${label}`} onClick={onDelete}>
            <X size={14} strokeWidth={2} aria-hidden />
          </RowIconButton>
        </HoverTip>
      ) : null}
    </div>
  );
}
