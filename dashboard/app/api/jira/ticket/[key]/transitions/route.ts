import { NextResponse } from "next/server";
import { getTransitions } from "@/lib/jira-client";
import { withErrorHandler } from "@/lib/api-utils";

/** Available workflow transitions for a ticket (for the complete/abandon prompt). */
export const GET = withErrorHandler(
  async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    if (!process.env.JIRA_DOMAIN) {
      return NextResponse.json({ error: "Not configured" }, { status: 400 });
    }
    const transitions = await getTransitions(key);
    return NextResponse.json({ key, transitions });
  },
  "jira.transitions.get",
);
