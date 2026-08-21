import { NextRequest, NextResponse } from "next/server";
import { ensureDevHubOpenCode } from "@/lib/opencode/listen";
import { z } from "zod";
import { parseBody, withErrorHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

function opencodeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  }
  return headers;
}

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
 * Start an OpenCode session with a prompt (same seam as Datadog Investigate).
 * Callers navigate to /opencode and requestOpenCodeSession(sessionId).
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

  const base = `http://127.0.0.1:${await ensureDevHubOpenCode()}`;
  const headers = opencodeHeaders();

  try {
    const sessionBody: Record<string, unknown> = { title: title.slice(0, 80) };
    if (body.directory?.trim()) {
      sessionBody.directory = body.directory.trim();
    }

    const sessionRes = await fetch(`${base}/session`, {
      method: "POST",
      headers,
      body: JSON.stringify(sessionBody),
    });
    if (!sessionRes.ok) {
      return NextResponse.json(
        { ok: false, error: `OpenCode session create failed (${sessionRes.status})` },
        { status: 502 },
      );
    }
    const session = (await sessionRes.json()) as { id?: string };
    if (!session.id) {
      return NextResponse.json({ ok: false, error: "OpenCode returned no session id" }, { status: 502 });
    }

    const promptRes = await fetch(`${base}/session/${session.id}/prompt_async`, {
      method: "POST",
      headers,
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
    });
    if (!promptRes.ok && promptRes.status !== 204) {
      return NextResponse.json(
        { ok: false, error: `OpenCode prompt failed (${promptRes.status})`, sessionId: session.id },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, sessionId: session.id });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Could not reach OpenCode.",
      },
      { status: 502 },
    );
  }
}, "agent.run");
