import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth, isSameOriginStrict, parseBody, withErrorHandler } from "@/lib/api-utils";
import { DestinationSchema, EVENT_LABELS, alertText } from "@/lib/integrations/alert-types";
import { readAlerts, saveDestination, decideDelivery, sendTestAlert } from "@/lib/integrations/alert-store";
import { alertProfile } from "@/lib/integrations/alert-worker";
import { IntegrationError } from "@/lib/integrations/types";
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test"), id: z.string().uuid(), revision: z.number().int().positive(), requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("save"), destination: DestinationSchema, revision: z.number().int().nonnegative(), consent: z.literal(true) }).strict(),
  z.object({ action: z.literal("delivery"), id: z.string().regex(/^[a-f0-9]{64}$/), retry: z.boolean(), acknowledgeDuplicate: z.boolean() }).strict(),
]);
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  const profile = alertProfile(); const state = readAlerts();
  return NextResponse.json({ profile, destinations: state.destinations.filter((d) => d.workProfile === profile).map(({ credentialHash: _hash, ...destination }) => { void _hash; return destination; }), outbox: state.outbox.filter((e) => e.workProfile === profile).slice(-100).reverse(), events: EVENT_LABELS, preview: alertText("approval-ready", "example") }, { headers: { "Cache-Control": "no-store" } });
}, "integrations.alerts.get");
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Manage alert consent in DevHub." }, { status: 403 });
  const parsed = await parseBody(req, Input); if (!parsed.ok) return parsed.response;
  try {
    const value = parsed.data;
    if (value.action === "test") return NextResponse.json({ delivery: await sendTestAlert(value.id, value.revision, value.requestId, alertProfile()) }, { headers: { "Cache-Control": "no-store" } });
    if (value.action === "save") await saveDestination(value.destination, value.revision, alertProfile());
    else {
      if (value.retry && !value.acknowledgeDuplicate) return NextResponse.json({ error: "Check the channel and acknowledge possible duplicates before retrying." }, { status: 409 });
      await decideDelivery(value.id, value.retry, alertProfile());
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "Could not save alert settings. Refresh and try again." }, { status: error instanceof IntegrationError && error.kind === "conflict" ? 409 : error instanceof IntegrationError && error.kind === "rate-limit" ? 429 : 400 });
  }
}, "integrations.alerts.post");
