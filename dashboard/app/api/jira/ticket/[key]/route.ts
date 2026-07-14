import { NextResponse } from "next/server";
import { getTicket } from "@/lib/jira-client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  if (!process.env.JIRA_DOMAIN) {
    return NextResponse.json({ error: "Not configured" }, { status: 400 });
  }

  try {
    const ticket = await getTicket(key);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let grandparent: { key: string; summary: string } | null = null;
    if (ticket.parent) {
      const gp = await getTicket(ticket.parent.key).catch(() => null);
      if (gp?.parent) grandparent = gp.parent;
    }

    return NextResponse.json({
      key: ticket.key,
      status: ticket.status,
      summary: ticket.summary,
      issuetype: ticket.issuetype,
      parent: ticket.parent,
      grandparent,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
