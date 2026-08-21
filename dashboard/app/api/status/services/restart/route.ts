import { NextResponse } from "next/server";
import { resolveOpenChamberBind, resolveOpenChamberPort } from "@/lib/openchamber-command";
import { ensureChamberListening, stopChamberPeer } from "@/lib/dev-peer-services";
import { ensureDevHubOpenCode, freePinnedOpenCodePorts, stopDevHubOpenCode } from "@/lib/opencode/listen";
import { DEV_SERVICES } from "@/lib/dev-services";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

async function restartOpenChamber(): Promise<NextResponse> {
  // `resolveOpenChamberBind` also carries the >=1.13 auth guard note: Chamber
  // exits with code 4 when binding a LAN address without UI auth, so it falls
  // back to loopback. Surface that to the caller instead of failing silently.
  const { host, note } = resolveOpenChamberBind();
  await stopChamberPeer(() => undefined, resolveOpenChamberPort());
  const port = await ensureChamberListening();
  return NextResponse.json({ ok: true, restarted: true, port, host, note });
}

async function restartOpenCode(): Promise<NextResponse> {
  freePinnedOpenCodePorts();
  stopDevHubOpenCode();
  const port = await ensureDevHubOpenCode();
  return NextResponse.json({ ok: true, restarted: true, port });
}

/** `unit` is the legacy field name; both are accepted so old callers keep working. */
const RestartSchema = z.object({
  service: z.string().optional(),
  unit: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, RestartSchema);
  if (!parsed.ok) return parsed.response;
  const service = parsed.data.service ?? parsed.data.unit;

  const known = DEV_SERVICES.map((s) => s.id);
  if (!service || !known.includes(service)) {
    return NextResponse.json(
      { error: "Unknown service", known },
      { status: 400 },
    );
  }

  try {
    if (service === "openchamber") return await restartOpenChamber();
    if (service === "opencode") return await restartOpenCode();
  } catch (err) {
    // Restart is a user-facing button; a dead binary or a held port should read
    // as "couldn't restart", not a 500 with a stack trace.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: "Unhandled service" }, { status: 500 });
}
