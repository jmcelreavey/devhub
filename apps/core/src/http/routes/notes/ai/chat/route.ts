import { notesAiChat } from "../../../../../../../../packages/shared/actions/notes";
import { withErrorHandler } from "../../../../../lib/api-utils";
import { NOTES_AI_NOT_CONFIGURED } from "../../../../../../../../packages/shared/ui-lib/notes-ai/constants";
import { streamNotesAiChat, type NotesAiChatBody } from "../../../../../lib/notes-ai/stream-chat";


export const POST = withErrorHandler(async (req: Request) => {
  const input = notesAiChat.input.parse({ body: await req.json() });
  return await notesAiChat.handler(input, { execute: async ({ body: value }) => {
    const body = value as NotesAiChatBody;
    const result = await streamNotesAiChat(body);
    if (!result) {
      return Response.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
    }
    return result.toUIMessageStreamResponse();
  } }) as Response;
}, "notes.ai.chat");
