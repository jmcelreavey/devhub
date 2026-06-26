import { convertToModelMessages, streamText } from "ai";
import { injectDocumentStateMessages, toolDefinitionsToToolSet } from "@blocknote/xl-ai/server";
import { BLOCKNOTE_HTML_SYSTEM_PROMPT } from "@/lib/notes-ai/blocknote-html-system-prompt";
import { getNotesAiModel } from "@/lib/ai-provider";

export interface NotesAiChatBody {
  messages: Parameters<typeof injectDocumentStateMessages>[0];
  toolDefinitions: Parameters<typeof toolDefinitionsToToolSet>[0];
}

export async function streamNotesAiChat(body: NotesAiChatBody) {
  const model = getNotesAiModel();
  if (!model) return null;

  return streamText({
    model,
    system: BLOCKNOTE_HTML_SYSTEM_PROMPT,
    messages: await convertToModelMessages(injectDocumentStateMessages(body.messages)),
    tools: toolDefinitionsToToolSet(body.toolDefinitions),
    toolChoice: "required",
    maxOutputTokens: 4096,
  });
}
