import { startBackgroundAgent } from "../../../../lib/agent-runs/background";
import { parseBody,withErrorHandler } from "../../../../lib/api-utils";
import { httpAction } from "../../../../lib/actions/http";
import { agentBackground, agentBackgroundInput } from "../../../../../../../packages/shared/actions/agents";
import { getNotesDir } from "../../../../lib/notes/dir";
import type { z } from "zod";


/**
 * Start a managed conversation without changing any browser or terminal.
 * The caller receives durable run and conversation IDs for an explicit link.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, agentBackgroundInput);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return httpAction(agentBackground, {
    input: () => body,
    context: () => ({ execute: startAgent }),
    response: (response) => response as Response,
  })(req);
}, "agent.run");

async function startAgent(body: z.output<typeof agentBackgroundInput>) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > 32_000) {
    return Response.json({ ok: false, error: "prompt too long" }, { status: 400 });
  }

  const title =
    body.title?.trim() ||
    `DevHub ${body.kind ?? "agent"}${body.repoName ? ` · ${body.repoName}` : ""}`;

  let text = prompt;
  if (body.notePath?.trim()) {
    text = `${prompt}\n\n(Write results via notes MCP to path: ${body.notePath.trim()})`;
  }

  try {
    const started = await startBackgroundAgent({
      prompt: text,
      title,
      cwd: body.directory?.trim() || getNotesDir(),
      provider: body.provider,
      activity: { source: "interactive", action: body.kind || "agent", repoName: body.repoName, notePath: body.notePath },
    });
    return Response.json({
      ok: true,
      providerLabel: started.providerLabel,
      runId: started.runId,
      conversationId: started.conversationId,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not start the agent." },
      { status: 502 },
    );
  }
}
