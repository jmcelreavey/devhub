import { NextResponse } from "next/server";
import { getJiraMeta } from "@/lib/jira-client";
import { withErrorHandler } from "@/lib/api-utils";

const DEFAULT_PROJECT = process.env.JIRA_DEFAULT_PROJECT?.trim() || "PTF";

/**
 * Detected Jira context for the "Add to Jira" modal: the authenticated user,
 * the project's board + active sprint, and the Team value (optionally inherited
 * from `reference`, e.g. the task's current parent ticket).
 */
export const GET = withErrorHandler(async (req: Request) => {
  if (!process.env.JIRA_DOMAIN) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  const url = new URL(req.url);
  const projectKey = (url.searchParams.get("project") || DEFAULT_PROJECT).toUpperCase();
  const reference = url.searchParams.get("reference") || undefined;
  const meta = await getJiraMeta(projectKey, reference);
  return NextResponse.json(meta);
}, "jira.meta");
