import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { ensureTasksMigrated } from "@/lib/tasks/storage";
import { captureJiraTask, jiraIntakeProfile, jiraLinkedTasks } from "@/lib/tasks/jira-intake";

export const dynamic = "force-dynamic";

const JiraCaptureSchema = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
  summary: z.string().trim().min(1).max(1000),
  url: z.string().url().refine((value) => ["https:", "http:"].includes(new URL(value).protocol), "Use a Jira browse URL"),
  profile: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).optional(),
});

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  await ensureTasksMigrated();
  return NextResponse.json({ profile: jiraIntakeProfile(), linked: jiraLinkedTasks() });
}, "tasks.jiraIntake.get");

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, JiraCaptureSchema);
  if (!parsed.ok) return parsed.response;
  await ensureTasksMigrated();
  const result = await captureJiraTask(parsed.data);
  if ("profileChanged" in result) return NextResponse.json({ error: "The active profile changed. Refresh before adding this ticket." }, { status: 409 });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
}, "tasks.jiraIntake.post");
