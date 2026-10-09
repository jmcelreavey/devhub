import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/api-utils";
import { getCheckoutRoot, getRepoRoot } from "@/lib/content/dirs";
import { paseoWebOrigin } from "@/lib/paseo/client";
import { defaultPaseoProvider, listPaseoProviders } from "@/lib/paseo/providers";

export const dynamic = "force-dynamic";

/** Agents the launch sheet can pick and the web origin the Chats frame loads. */
async function connection() {
  try {
    const providers = await listPaseoProviders();
    return NextResponse.json({
      connected: true, origin: paseoWebOrigin(), defaultCwd: getCheckoutRoot() ?? getRepoRoot(),
      defaultAgentId: defaultPaseoProvider(providers) ?? "",
      agents: providers.map((p) => ({ id: p.id, name: p.label, ready: p.ready, models: p.models, ...(p.error ? { error: p.error } : {}) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error && "detail" in error && typeof error.detail === "string" ? error.detail : null;
    const setupHref = error instanceof Error && "setupHref" in error && typeof error.setupHref === "string" ? error.setupHref : null;
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : "Could not connect to Paseo.",
      detail,
      setupHref,
    }, { status: 200 });
  }
}

export async function GET(req: NextRequest) {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  // 200 when Paseo is down so callers can show why instead of a generic failure.
  return connection();
}
