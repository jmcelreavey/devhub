"use client";

import { InlineNoteRename } from "@/components/InlineNoteRename";

/** Note title in the page header — inline rename in breadcrumb or standalone title. */
export function NotePageTitle({
  noteSlug,
  title,
  nested,
  isNew,
  onRenamed,
  renameFile,
}: {
  noteSlug: string;
  title: string;
  nested: boolean;
  isNew: boolean;
  onRenamed: (newSlug: string) => void;
  renameFile?: (currentSlug: string, newBaseName: string) => Promise<string>;
}) {
  const shared = {
    noteSlug,
    displayName: title,
    disabled: isNew,
    onRenamed,
    renameFile,
    title: "Click to rename note",
  } as const;

  if (nested) {
    return (
      <InlineNoteRename
        {...shared}
        className="font-semibold break-words"
        style={{ color: "var(--text)", fontSize: "1.125rem", lineHeight: 1.3 }}
        inputClassName="min-w-0 flex-1 bg-transparent border-none outline-none font-semibold break-words"
      />
    );
  }

  return (
    <InlineNoteRename
      {...shared}
      className="page-title break-words"
      inputClassName="page-title w-full bg-transparent border-none outline-none break-words"
    />
  );
}
