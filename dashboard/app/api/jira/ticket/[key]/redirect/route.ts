import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const domain = process.env.JIRA_DOMAIN;
  if (!domain) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 501 });
  }
  const url = `https://${domain}/browse/${key}`;
  return NextResponse.redirect(url);
}
