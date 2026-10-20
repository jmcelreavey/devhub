import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { requireTeamCollaboration, teamCollaboration } from "@/lib/team/collaboration";

export const dynamic = "force-dynamic";
const taskId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const teammate = z.string().trim().min(1).max(200);
const token = z.string().regex(/^[a-f0-9]{32}$/);
const Input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), taskId, teammate, channel: z.string().regex(/^[CG][A-Z0-9]+$/).optional() }).strict(),
  z.object({ action: z.literal("handoff"), taskId, teammate, reassignJira: z.boolean().optional(), commitWip: z.boolean().optional(), postConfirmation: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("confirm"), token, reassignJira: z.boolean().optional(), cancel: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("send"), token, answer: z.string().trim().min(1).max(12000) }).strict(),
]);
export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const suggestion = req.nextUrl.searchParams.get("token");
  if (suggestion) {
    if (!token.safeParse(suggestion).success) return NextResponse.json({ error: "Invalid suggested answer" }, { status: 400 });
    return NextResponse.json(await requireTeamCollaboration().asks.preview(suggestion));
  }
  const service = teamCollaboration();
  if (!service) return NextResponse.json({ linked: false, members: [] });
  if (!service.env.active()) return NextResponse.json({ linked: true, online: false, members: [] });
  return NextResponse.json({ linked: true, online: true, members: await service.members() });
}, "team.collaboration.get");
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const input = await parseBody(req, Input);
  if (!input.ok) return input.response;
  const service = requireTeamCollaboration();
  const data = input.data;
  if (data.action === "ask") return NextResponse.json(await service.ask(data.taskId, data.teammate, data.channel));
  if (data.action === "handoff") {
    const preview = await service.handoff(data.taskId, data.teammate, data.reassignJira, data.commitWip);
    if (data.postConfirmation) await service.handoffs.postPreview(preview);
    return NextResponse.json(preview);
  }
  if (data.action === "confirm") await service.handoffs.confirm(data.token, data.reassignJira, data.cancel);
  else await service.asks.send(data.token, data.answer);
  return NextResponse.json({ ok: true });
}, "team.collaboration.post");

