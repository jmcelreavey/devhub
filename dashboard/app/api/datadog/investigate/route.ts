import { startBackgroundAgent } from "@/lib/agent-runs/background";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { z } from "zod";
import {
buildDatadogInvestigationPrompt,
type DatadogInvestigationInput,
} from "@/lib/datadog/investigation-prompt";
import { getNotesDir } from "@/lib/notes/dir";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const Input = z.object({
  prepare: z.boolean().optional(), scope: z.enum(["oncall", "team", "general"]).default("general"),
  title: z.string().max(1000).optional(), status: z.string().max(1000).optional(),
  tags: z.array(z.string().max(200)).max(100).optional(), timestampMs: z.number().finite().optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, Input);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const scope: DatadogInvestigationInput["scope"] =
    body.scope === "oncall" || body.scope === "team" ? body.scope : "general";

  const prompt = buildDatadogInvestigationPrompt({
    scope,
    title: typeof body.title === "string" ? body.title : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === "string") : undefined,
    timestampMs: typeof body.timestampMs === "number" ? body.timestampMs : undefined,
  });

  try {
    if (body.prepare === true) return NextResponse.json({ ok: true, prompt, title: `Datadog: ${typeof body.title === "string" ? body.title.slice(0, 60) : scope}`, cwd: getNotesDir() });
    const started = await startBackgroundAgent({
      prompt,
      title: `Datadog: ${body.title ? body.title.slice(0, 60) : scope}`,
      cwd: getNotesDir(),
      activity: { source: "investigation", action: "datadog" },
    });
    return NextResponse.json({
      ok: true,
      providerLabel: started.providerLabel,
      runId: started.runId,
      conversationId: started.conversationId,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not start the investigation agent." },
      { status: 502 },
    );
  }
}, "datadog.investigate");
