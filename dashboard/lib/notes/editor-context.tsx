"use client";

import { createContext, useContext, type ReactNode } from "react";

const NoteEditorContext = createContext<string | undefined>(undefined);

export function NoteEditorProvider({
  notePath,
  children,
}: {
  notePath?: string;
  children: ReactNode;
}) {
  return <NoteEditorContext.Provider value={notePath}>{children}</NoteEditorContext.Provider>;
}

export function useNoteEditorPath(): string | undefined {
  return useContext(NoteEditorContext);
}
