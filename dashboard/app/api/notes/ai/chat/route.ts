import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { NOTES_AI_NOT_CONFIGURED } from "@/lib/notes-ai/constants";
import { streamNotesAiChat, type NotesAiChatBody } from "@/lib/notes-ai/stream-chat";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (req: Request) => {
  const body = (await req.json()) as NotesAiChatBody;
  const result = await streamNotesAiChat(body);
  if (!result) {
    return NextResponse.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }
  return result.toUIMessageStreamResponse();
}, "notes.ai.chat");
