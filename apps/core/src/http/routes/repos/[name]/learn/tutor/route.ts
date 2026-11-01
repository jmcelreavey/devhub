import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { repoLearnTutor } from "../../../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../../../lib/actions/http";
import { withErrorHandler } from "../../../../../../lib/api-utils";
import { NOTES_AI_NOT_CONFIGURED } from "../../../../../../../../../packages/shared/ui-lib/notes-ai/constants";
import { isNotesAiConfigured } from "../../../../../../lib/notes-ai/config";
import { buildTutorSystemPrompt } from "../../../../../../lib/repos/learn-ai";
import { REPO_LEARN_TUTOR_START } from "../../../../../../../../../packages/shared/ui-lib/repos/learn-constants";
import { resolveRepoPath } from "../../../../../../lib/repos/learn-resolve";
import { getRepoContextForTutor } from "../../../../../../lib/repos/learn-tutor-context";
import { tutorMessageText } from "../../../../../../../../../packages/shared/ui-lib/repos/learn-tutor-utils";
import { getNotesAiModel, getNotesAiCallOptions } from "../../../../../../lib/ai/provider";

type Params = { params: Promise<{ name: string }> };


export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  if (!isNotesAiConfigured()) {
    return Response.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }

  const { name } = await params;
  const repoPath = resolveRepoPath(name);
  if (!repoPath) {
    return Response.json({ error: "Repo not found" }, { status: 404 });
  }

  const body = (await req.json()) as { messages?: UIMessage[] };
  const messages = body.messages ?? [];

  return httpAction(repoLearnTutor, {
    input: () => ({ name, messages }),
    context: () => ({ stream: async (_repo, inputMessages) => {
      const response = await streamTutor(repoPath, inputMessages as UIMessage[]);
      return { body: response.body, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) };
    } }),
    response: (result) => new Response(result.body, { status: result.status, statusText: result.statusText, headers: result.headers }),
  })(req);
}, "repos.learn.tutor");

async function streamTutor(repoPath: string, messages: UIMessage[]) {
  const model = getNotesAiModel({ action: "Repository learning tutor" });
  if (!model) {
    return Response.json({ error: NOTES_AI_NOT_CONFIGURED }, { status: 503 });
  }

  const context = await getRepoContextForTutor(repoPath);
  const system = buildTutorSystemPrompt(context);

  const modelMessages = await convertToModelMessages(messages);
  const promptMessages = modelMessages.map((m) => {
    if (m.role === "user" && tutorMessageText(m.content) === REPO_LEARN_TUTOR_START) {
      return {
        ...m,
        content: [
          {
            type: "text" as const,
            text: "Start the tutoring session. Ask me your first calibration question.",
          },
        ],
      };
    }
    return m;
  });

  const result = streamText({
    model,
    system,
    messages: promptMessages,
    maxOutputTokens: 1024,
    ...getNotesAiCallOptions(),
  });

  return result.toUIMessageStreamResponse();
}
