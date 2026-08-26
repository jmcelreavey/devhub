import { NextRequest, NextResponse } from "next/server";
import { getTasks } from "@/lib/tasks/storage";
import { extractTags } from "@/lib/entity-note";
import { taskNotePath } from "@/lib/task-note";
import { getTicket } from "@/lib/jira/client";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId")?.trim();
  const requestedDate = req.nextUrl.searchParams.get("date")?.trim() || undefined;
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const date = requestedDate ?? new Date().toISOString().slice(0, 10);

  const task = getTasks(date).find((t) => t.id === taskId);
  if (!task) return NextResponse.json({ error: `Task ${taskId} not found` }, { status: 404 });

  const tags = extractTags(task.text);
  const links = task.links ?? [];
  const repoIds = links.filter((link) => link.kind === "repo").map((link) => link.id);
  const notePath = taskNotePath({
    id: task.id,
    text: task.text,
    date,
    jiraKey: task.jiraKey,
  });
  const jira = task.jiraKey ? await getTicket(task.jiraKey).catch(() => null) : null;
  const localRepos = repoIds.length === 1 ? await resolveLocalGithubRepos().catch(() => []) : [];
  const repoId = repoIds[0]?.toLowerCase();
  const localRepo = repoId
    ? localRepos.find(({ fullName, repo }) =>
        fullName.toLowerCase() === repoId || (!repoId.includes("/") && repo.name.toLowerCase() === repoId),
      )
    : null;

  return NextResponse.json({
    id: task.id,
    date,
    text: task.text,
    done: task.done,
    abandonedAt: task.abandonedAt ?? null,
    tags,
    jiraKey: task.jiraKey ?? null,
    jira: jira ? { key: jira.key, summary: jira.summary, status: jira.status.name, issuetype: jira.issuetype } : null,
    notePath,
    links,
    repos: repoIds,
    repoPath: localRepo?.repo.path ?? null,
  });
}
