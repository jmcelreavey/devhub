import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { IntegrationError } from "./types";
import { alertProfile } from "./alert-worker";
import { requestWrite, reviewWrite, cancelWrite, confirmWrite, listWrites } from "./write-store";
import { WriteInputSchema } from "./write-types";
import { chatStatus } from "./chat";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), input: WriteInputSchema }).strict(),
  z.object({ action: z.enum(["review", "cancel"]), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("confirm"), id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
]);
export function integrationFailure(error: unknown) {
  const status = error instanceof IntegrationError ? ({ auth: 401, "rate-limit": 429, "not-found": 404, unsupported: 422, conflict: 409, unavailable: 503, invalid: 400 })[error.kind] : 503;
  return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "The integration could not complete this request. Refresh its status before trying again." }, { status });
}
export async function getWrites(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  try { return NextResponse.json({ now: Date.now(), proposals: listWrites(alertProfile()).slice(0, 100), chat: chatStatus(alertProfile()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return integrationFailure(error); }
}
export async function postWrite(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Review and confirm this action in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, Input); if (!parsed.ok) return parsed.response;
  try {
    const input = parsed.data; const profile = alertProfile();
    if (input.action === "propose") return NextResponse.json({ proposal: await requestWrite(input.input, profile) });
    if (input.action === "review") return NextResponse.json({ proposal: await reviewWrite(input.id, profile, req.signal) });
    if (input.action === "cancel") return NextResponse.json({ proposal: await cancelWrite(input.id, profile) });
    if (input.action === "confirm") return NextResponse.json({ proposal: await confirmWrite(input.id, input.digest, profile, req.signal) });
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) { return integrationFailure(error); }
}
