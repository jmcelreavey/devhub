import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { IntegrationError } from "./types";
import { alertProfile } from "./alert-worker";
import { requestWrite, reviewWrite, cancelWrite, confirmWrite, listWrites, writeNow, type DirectWrite } from "./write-store";
import { WriteInputSchema } from "./write-types";
import { chatStatus } from "./chat";

const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), input: WriteInputSchema }).strict(),
  z.object({ action: z.literal("direct"), input: WriteInputSchema }).strict(),
  z.object({ action: z.enum(["review", "cancel"]), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("confirm"), id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true), via: z.literal("chat").optional(), quote: z.string().trim().min(1).max(500).optional() }).strict(),
]);
export function integrationFailure(error: unknown) {
  const status = error instanceof IntegrationError ? ({ auth: 401, "rate-limit": 429, "not-found": 404, unsupported: 422, conflict: 409, unavailable: 503, invalid: 400 })[error.kind] : 503;
  return NextResponse.json({ error: error instanceof IntegrationError ? error.message : "The integration could not complete this request. Refresh its status before trying again." }, { status });
}
/**
 * True for a person's own click in the DevHub UI, as opposed to an agent, MCP
 * tool or chat bridge calling the same endpoint. The intent header is a routing
 * signal, not a credential: dashboard auth and the strict same-origin check
 * still gate the request, and the MCP client always identifies itself.
 */
export function isDirectUserRequest(req: NextRequest): boolean {
  if (!isSameOriginStrict(req)) return false;
  if (req.headers.get("x-devhub-intent") !== "direct") return false;
  if (req.headers.get("x-devhub-client") || req.headers.get("x-devhub-secret")) return false;
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin";
}
/** Reviewers should be able to tell an agent's proposal from their own. */
export function proposalSource(req: NextRequest) { return req.headers.get("x-devhub-client") === "mcp" ? "MCP" : "DevHub"; }
export const AGENT_MUST_PROPOSE = "Agents and chat propose actions; a person confirms them in DevHub, or approves them in chat for the agent to confirm.";
export function serverTiming(timings: Record<string, number>) {
  return { "Server-Timing": Object.entries(timings).map(([name, dur]) => name + ";dur=" + dur).join(", ") };
}
/** Legacy routes answer a direct write in their old shape, plus the receipt, so callers need no new handling. */
export function directOutcome({ proposal, timings }: DirectWrite, legacy: Record<string, unknown>, successStatus = 200) {
  const headers = serverTiming(timings);
  if (proposal.state === "succeeded") return NextResponse.json({ ...legacy, ok: true, proposal }, { status: successStatus, headers });
  const outcome = proposal.state === "unknown" ? "unknown" : "failed";
  return NextResponse.json({ error: proposal.detail ?? "The action was not completed.", outcome, proposal }, { status: 409, headers });
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
    if (input.action === "direct") {
      if (!isDirectUserRequest(req)) return NextResponse.json({ error: AGENT_MUST_PROPOSE }, { status: 403 });
      const result = await writeNow(input.input, profile, req.signal);
      return NextResponse.json(result, { headers: serverTiming(result.timings) });
    }
    if (input.action === "propose") return NextResponse.json({ proposal: await requestWrite(input.input, profile, proposalSource(req)) });
    if (input.action === "review") return NextResponse.json({ proposal: await reviewWrite(input.id, profile, req.signal) });
    if (input.action === "cancel") return NextResponse.json({ proposal: await cancelWrite(input.id, profile) });
    if (input.action === "confirm") {
      // Saying "do it" in a chat, or through MCP, is as good as a click: the exact reviewed digest still has to match, and the words are kept in the trail.
      if (input.via === "chat" && !input.quote) return NextResponse.json({ error: "Include the words in which the person approved this." }, { status: 400 });
      const approval = input.via === "chat" ? { via: "chat" as const, quote: input.quote! } : undefined;
      return NextResponse.json({ proposal: await confirmWrite(input.id, input.digest, profile, req.signal, {}, approval) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) { return integrationFailure(error); }
}
