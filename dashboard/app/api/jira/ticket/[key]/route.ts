import { NextResponse } from "next/server";
import { getTicket } from "@/lib/jira/client";
import { notConfigured } from "@/lib/api-utils";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!process.env.JIRA_DOMAIN) {
    return notConfigured("Jira");
  }

  try {
    const ticket = await getTicket(key);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const parentDetail = ticket.parent ? await getTicket(ticket.parent.key).catch(() => null) : null;

    return NextResponse.json({
      key: ticket.key,
      status: ticket.status,
      summary: ticket.summary,
      issuetype: ticket.issuetype,
      parent: ticket.parent ? { ...ticket.parent, issuetype: parentDetail?.issuetype } : null,
      grandparent: parentDetail?.parent ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
