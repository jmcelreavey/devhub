import { NextRequest, NextResponse } from "next/server";
import { getTasks } from "@/lib/tasks/storage";
import { extractTags } from "@/lib/entity-note";
import { taskNotePath } from "@/lib/task-note";
import { getTicket } from "@/lib/jira/client";
import { resolveEntityContext } from "@/lib/entity-links/resolve";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { selectTaskImplementationRepo } from "@/lib/tasks/implement-repo";
import { buildPlanMarkdown } from "@/lib/tasks/plan-markdown";

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

  // Portable copy for teammates or agents off this machine.
  if (req.nextUrl.searchParams.get("format") === "markdown") {
    return new NextResponse(buildPlanMarkdown(task, date), {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const tags = extractTags(task.text);
  const links = task.links ?? [];
  // Repo choice must come from the task's OWN links: a back-link from a task in
  // another repo must not silently change which checkout the agent works in.
  const repoIds = links.filter((link) => link.kind === "repo").map((link) => link.id);
  const notePath = taskNotePath({
    id: task.id,
    text: task.text,
    date,
    jiraKey: task.jiraKey,
  });
  // The agent used to crawl this itself, one MCP call per hop, and only ever
  // reached depth 1. Resolve it here instead: `related` is the direct
  // neighbourhood (outbound links + whatever links back), `context` is one hop
  // further — a prerequisite task's plan note, a linked ticket's PR.
  const graph = resolveEntityContext("task", task.id, { date, label: task.text, depth: 2 });
  const jira = task.jiraKey ? await getTicket(task.jiraKey).catch(() => null) : null;
  // More than one linked repo: start in the requested one (if it is linked),
  // else the first. The others stay in `repos` — this only picks the checkout.
  const requestedRepo = req.nextUrl.searchParams.get("repo")?.trim().toLowerCase();
  const localRepos = repoIds.length > 0 ? await resolveLocalGithubRepos().catch(() => []) : [];
  const repoId =
    repoIds.find((id) => id.toLowerCase() === requestedRepo)?.toLowerCase() ?? repoIds[0]?.toLowerCase();
  const localRepo = repoId ? selectTaskImplementationRepo(repoId, localRepos) : null;

  return NextResponse.json({
    id: task.id,
    date,
    text: task.text,
    done: task.done,
    stage: task.stage ?? "ready",
    abandonedAt: task.abandonedAt ?? null,
    tags,
    jiraKey: task.jiraKey ?? null,
    jira: jira ? { key: jira.key, summary: jira.summary, status: jira.status.name, issuetype: jira.issuetype } : null,
    notePath,
    links,
    notes: graph.notes,
    related: graph.related,
    context: graph.expanded,
    repos: repoIds,
    repoPath: localRepo?.repo.path ?? null,
  });
}
