import { filterSuggestionItems } from "@blocknote/core";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { getAISlashMenuItems } from "@blocknote/xl-ai";
import { asBlockNoteAiEditor } from "@/lib/blocknote-ai-editor";

interface DevHubSlashMenuOptions {
  includeAi?: boolean;
  prepend?: DefaultReactSuggestionItem[];
}

/** Slash menu items shared by notes editor (with or without in-editor AI). */
export function filterDevHubSlashMenuItems(
  editor: unknown,
  query: string,
  { includeAi = false, prepend = [] }: DevHubSlashMenuOptions = {},
): DefaultReactSuggestionItem[] {
  const typedEditor = editor as Parameters<typeof getDefaultReactSlashMenuItems>[0];
  return filterSuggestionItems(
    [
      ...prepend,
      ...getDefaultReactSlashMenuItems(typedEditor),
      ...(includeAi ? getAISlashMenuItems(asBlockNoteAiEditor(editor)) : []),
    ],
    query,
  );
}
