import { NextResponse } from "next/server";
import { resolveOpenCodePort } from "@/lib/opencode-command";
import {
  buildDatadogInvestigationPrompt,
  type DatadogInvestigationInput,
} from "@/lib/datadog-investigation-prompt";
import { withErrorHandler } from "@/lib/api-utils";

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

export const POST = withErrorHandler(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as Partial<DatadogInvestigationInput>;
  const scope: DatadogInvestigationInput["scope"] =
    body.scope === "oncall" || body.scope === "team" ? body.scope : "general";

  const prompt = buildDatadogInvestigationPrompt({
    scope,
    title: typeof body.title === "string" ? body.title : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : undefined,
    timestampMs: typeof body.timestampMs === "number" ? body.timestampMs : undefined,
  });

  const base = `http://127.0.0.1:${resolveOpenCodePort()}`;
  const headers = opencodeHeaders();
  const title = `Datadog: ${body.title ? body.title.slice(0, 60) : scope}`;

  try {
    const sessionRes = await fetch(`${base}/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title }),
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
      body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
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
        error: e instanceof Error ? e.message : "Could not reach OpenCode. Is it running on :1338?",
      },
      { status: 502 },
    );
  }
}, "datadog.investigate");
