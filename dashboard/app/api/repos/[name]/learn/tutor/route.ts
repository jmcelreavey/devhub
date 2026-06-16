import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { NOTES_AI_NOT_CONFIGURED } from "@/lib/notes-ai/constants";
import { isNotesAiConfigured } from "@/lib/notes-ai/config";
import { buildTutorSystemPrompt } from "@/lib/repo-learn-ai";
import { REPO_LEARN_TUTOR_START } from "@/lib/repo-learn-constants";
import { resolveRepoPath } from "@/lib/repo-learn-resolve";
import { getRepoContextForTutor } from "@/lib/repo-learn-tutor-context";
import { getZAiNotesModel } from "@/lib/z-ai";

type Params = { params: Promise<{ name: string }> };

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  if (!isNotesAiConfigured()) {
    return NextResponse.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }

  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const body = (await req.json()) as { messages?: UIMessage[] };
  const messages = body.messages ?? [];

  const model = getZAiNotesModel();
  if (!model) {
    return NextResponse.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }

  const context = await getRepoContextForTutor(repoPath);
  const system = buildTutorSystemPrompt(context);

  const modelMessages = await convertToModelMessages(messages);
  const filtered = modelMessages.filter((m) => {
    if (m.role !== "user") return true;
    return tutorMessageText(m.content) !== REPO_LEARN_TUTOR_START;
  });

  const result = streamText({
    model,
    system,
    messages: filtered,
    maxOutputTokens: 1024,
    providerOptions: { zai: { thinking: { type: "disabled" } } },
  });

  return result.toUIMessageStreamResponse();
}, "repos.learn.tutor");

import { tutorMessageText } from "@/lib/repo-learn-tutor-utils";