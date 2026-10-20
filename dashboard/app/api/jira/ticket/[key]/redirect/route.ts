import { NextRequest, NextResponse } from "next/server";
import { configuredJiraDomain } from "@/lib/jira/env";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const domain = configuredJiraDomain();
  if (!domain) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 501 });
  }
  const url = `https://${domain}/browse/${key}`;
  return NextResponse.redirect(url);
}
