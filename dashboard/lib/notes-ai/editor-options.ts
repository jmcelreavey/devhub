"use client";

import { en } from "@blocknote/core/locales";
import { AIExtension } from "@blocknote/xl-ai";
import { en as aiEn } from "@blocknote/xl-ai/locales";
import { DefaultChatTransport } from "ai";
import { NOTES_AI_CHAT_API } from "@/lib/notes-ai/constants";

/** BlockNote `useCreateBlockNote` options when in-editor AI is enabled. */
export function blocknoteNotesAiEditorOptions() {
  return {
    dictionary: { ...en, ai: aiEn },
    extensions: [
      AIExtension({
        transport: new DefaultChatTransport({ api: NOTES_AI_CHAT_API }),
      }),
    ],
  };
}
