import { NextResponse } from "next/server";
import { applyTransition } from "@/lib/jira-client";
import { JiraTransitionSchema, formatZodError } from "@/lib/schemas";
import { withErrorHandler, parseBody } from "@/lib/api-utils";
import { invalidateJiraTicketsCache } from "@/lib/jira-tickets-cache";
import { invalidateSidebarCountsCache } from "@/lib/sidebar-counts-cache";

/** Apply a workflow transition to a ticket (move it to a new state). */
export const POST = withErrorHandler(
  async (req: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params;
    if (!process.env.JIRA_DOMAIN) {
      return NextResponse.json({ error: "Not configured" }, { status: 400 });
    }
    const body = await parseBody<unknown>(req);
    const parsed = JiraTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    await applyTransition(key, parsed.data.transitionId);
    invalidateJiraTicketsCache();
    invalidateSidebarCountsCache();
    return NextResponse.json({ key, ok: true });
  },
  "jira.transition.apply",
);
