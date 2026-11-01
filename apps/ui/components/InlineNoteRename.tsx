"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { renameNoteFile } from "@/lib/notes/path";
import { useToast } from "@/lib/hooks/use-toast";

export function InlineNoteRename({
  noteSlug,
  displayName,
  editName,
  onRenamed,
  renameFile = renameNoteFile,
  disabled = false,
  active = true,
  className,
  style,
  inputClassName,
  title = "Click to rename",
  onEditingChange,
  editRequest = 0,
}: {
  noteSlug: string;
  displayName: string;
  /** Basename used when renaming; defaults to displayName. */
  editName?: string;
  onRenamed: (newSlug: string) => void;
  renameFile?: (currentSlug: string, newBaseName: string) => Promise<string>;
  disabled?: boolean;
  /** When false, single-click passes through (e.g. inside a navigation link). */
  active?: boolean;
  onEditingChange?: (editing: boolean) => void;
  className?: string;
  style?: CSSProperties;
  inputClassName?: string;
  title?: string;
  /** Bump to start a rename from a context menu. */
  editRequest?: number;
}) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameBase = editName ?? displayName;

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    onEditingChange?.(renaming);
  }, [renaming, onEditingChange]);

  // `editRequest` is a bump counter, so this is the "adjusting state when a prop
  // changes" case: compare against the last one seen during render rather than
  // reacting in an effect, which would render once with the old state first.
  const [seenEditRequest, setSeenEditRequest] = useState(editRequest);
  if (editRequest !== seenEditRequest) {
    setSeenEditRequest(editRequest);
    if (editRequest && !disabled) {
      setRenaming(true);
      setValue(renameBase);
    }
  }

  const cancel = () => {
    setRenaming(false);
    setValue("");
  };

  const startRename = (e: MouseEvent) => {
    if (disabled || renaming) return;
    e.preventDefault();
    e.stopPropagation();
    setRenaming(true);
    setValue(renameBase);
  };

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === renameBase) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      const newSlug = await renameFile(noteSlug, trimmed);
      setRenaming(false);
      onRenamed(newSlug);
      toast.success("Renamed.");
    } catch (err) {
      if (err instanceof Error && err.message === "unchanged") {
        cancel();
        return;
      }
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not rename note.");
    } finally {
      setBusy(false);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (renaming) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onInputKeyDown}
        onBlur={() => {
          window.setTimeout(() => void commit(), 0);
        }}
        onClick={(e) => e.stopPropagation()}
        className={inputClassName ?? "min-w-0 flex-1 bg-transparent border-none outline-none text-xs truncate"}
        style={{ color: "var(--text)", ...style }}
        aria-label={`Rename ${displayName}`}
      />
    );
  }

  return (
    <span
      className={className}
      style={{ cursor: disabled ? undefined : "text", ...style }}
      onClick={(e) => {
        if (active) startRename(e);
      }}
      onDoubleClick={(e) => {
        if (disabled) return;
        startRename(e);
      }}
      title={disabled ? undefined : title}
    >
      {displayName}
    </span>
  );
}
