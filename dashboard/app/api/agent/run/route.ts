import { startBackgroundAgent } from "@/lib/agent-runs/background";
import { parseBody,withErrorHandler } from "@/lib/api-utils";
import { getNotesDir } from "@/lib/notes/dir";
import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AgentRunSchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required").max(32_000, "prompt too long"),
  title: z.string().optional(),
  directory: z.string().optional(),
  notePath: z.string().optional(),
  kind: z.string().optional(),
  repoName: z.string().optional(),
  /** Forward-compat with the shared AI provider switch. */
  provider: z.string().optional(),
});

/**
 * Start a managed conversation without changing any browser or terminal.
 * The caller receives durable run and conversation IDs for an explicit link.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, AgentRunSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > 32_000) {
    return NextResponse.json({ ok: false, error: "prompt too long" }, { status: 400 });
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
    return NextResponse.json({
      ok: true,
      providerLabel: started.providerLabel,
      runId: started.runId,
      conversationId: started.conversationId,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not start the agent." },
      { status: 502 },
    );
  }
}, "agent.run");
