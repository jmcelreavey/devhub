import { NextResponse } from "next/server";
import { getTicket } from "@/lib/jira-client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!process.env.JIRA_DOMAIN) {
    return NextResponse.json({ error: "Not configured" }, { status: 400 });
  }

  try {
    const ticket = await getTicket(key);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      key,
      status: ticket.status,
      summary: ticket.summary,
      issuetype: ticket.issuetype,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
