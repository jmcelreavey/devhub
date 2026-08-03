"use client";

import { InlineNoteRename } from "@/components/InlineNoteRename";
import { truncateMachineFilename } from "@/lib/vault/display-title";

/** Note title in the page header — content title when known, else truncated filename. */
export function NotePageTitle({
  noteSlug,
  title,
  displayTitle,
  nested,
  isNew,
  onRenamed,
  renameFile,
}: {
  noteSlug: string;
  /** File basename (used for rename). */
  title: string;
  /**
   * Content-derived title (first H1 / frontmatter). Pass only when it differs from
   * the filename — truncated machine names are handled here, not via this prop.
   */
  displayTitle?: string;
  nested: boolean;
  isNew: boolean;
  onRenamed: (newSlug: string) => void;
  renameFile?: (currentSlug: string, newBaseName: string) => Promise<string>;
}) {
  const contentTitle = displayTitle?.trim();
  const fromContent = Boolean(contentTitle);
  const label = contentTitle || truncateMachineFilename(title);
  const fileHint = truncateMachineFilename(title);

  const renameProps = {
    noteSlug,
    displayName: fromContent ? fileHint : label,
    editName: title,
    disabled: isNew,
    onRenamed,
    renameFile,
    title: fromContent ? "Click to rename file" : "Click to rename note",
  } as const;

  if (fromContent) {
    // Content title is the hero; filename stays a quiet rename target beside it.
    if (nested) {
      return (
        <span className="inline-flex items-baseline gap-2 min-w-0 max-w-full flex-wrap">
          <span
            className="font-semibold break-words"
            style={{ color: "var(--text)", fontSize: "1.125rem", lineHeight: 1.3 }}
          >
            {label}
          </span>
          <InlineNoteRename
            {...renameProps}
            className="text-[11px] text-text-muted break-all"
            inputClassName="min-w-0 bg-transparent border-none outline-none text-[11px] text-text-muted"
          />
        </span>
      );
    }
    return (
      <div className="min-w-0">
        <div className="page-title break-words">{label}</div>
        <InlineNoteRename
          {...renameProps}
          className="mt-1 text-xs text-text-muted break-all"
          inputClassName="w-full bg-transparent border-none outline-none text-xs text-text-muted"
        />
      </div>
    );
  }

  if (nested) {
    return (
      <InlineNoteRename
        {...renameProps}
        className="font-semibold break-words"
        style={{ color: "var(--text)", fontSize: "1.125rem", lineHeight: 1.3 }}
        inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none font-semibold break-words"
      />
    );
  }

  return (
    <InlineNoteRename
      {...renameProps}
      className="page-title break-words"
      inputClassName="page-title w-full bg-transparent border-none outline-none break-words"
    />
  );
}
