import { httpAction } from "../../../../../lib/actions/http";
import { taskPlanMarkdown } from "../../../../../../../../packages/shared/actions/plans";
import { getTasks, ensureTasksMigrated } from "../../../../../domains/tasks/storage";
import { todayISO } from "../../../../../../../../packages/shared/utils.ts";
import { resolveTaskNotePath } from "../../../../../domains/tasks/task-notes";
import { getTicket } from "../../../../../lib/jira/client";
import { resolveEntityContext } from "../../../../../lib/entity-links/resolve";
import { resolveLocalGithubRepos } from "../../../../../lib/repos/resolution";
import { selectTaskImplementationRepo } from "../../../../../../../../packages/shared/ui-lib/tasks/implement-repo";
import { buildPlanMarkdown } from "../../../../../domains/tasks/plan-markdown";
import { readSourceContextIfPresent } from "../../../../../domains/tasks/source-context";
import { readImplementReviewPrefs, reviewerForPlan } from "../../../../../domains/tasks/implement-review-prefs";


export async function GET(req: Request) {
  const taskId = new URL(req.url).searchParams.get("taskId")?.trim();
  const requestedDate = new URL(req.url).searchParams.get("date")?.trim() || undefined;
  if (!taskId) return Response.json({ error: "taskId required" }, { status: 400 });
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const date = requestedDate ?? todayISO();

  await ensureTasksMigrated();
  const task = getTasks(date).find((t) => t.id === taskId);
  if (!task) return Response.json({ error: `Task ${taskId} not found` }, { status: 404 });

  // Portable copy for teammates or agents off this machine.
  if (new URL(req.url).searchParams.get("format") === "markdown") {
    const markdown = buildPlanMarkdown(task, date);
    return httpAction(taskPlanMarkdown, {
      input: () => ({ taskId, date }),
      context: () => ({ read: () => markdown }),
      response: (value) => new Response(value, { headers: { "Content-Type": "text/markdown; charset=utf-8" } }),
    })(req);
  }

  const links = task.links ?? [];
  // Repo choice must come from the task's OWN links: a back-link from a task in
  // another repo must not silently change which checkout the agent works in.
  const repoIds = links.filter((link) => link.kind === "repo").map((link) => link.id);
  const notePath = resolveTaskNotePath(task, date);
  // The agent used to crawl this itself, one MCP call per hop, and only ever
  // reached depth 1. Resolve it here instead: `related` is the direct
  // neighbourhood (outbound links + whatever links back), `context` is one hop
  // further — a prerequisite task's plan note, a linked ticket's PR.
  const graph = resolveEntityContext("task", task.id, { date, label: task.text, depth: 2 });
  const jira = task.jiraKey ? await getTicket(task.jiraKey).catch(() => null) : null;
  // More than one linked repo: start in the requested one (if it is linked),
  // else the first. The others stay in `repos` — this only picks the checkout.
  const requestedRepo = new URL(req.url).searchParams.get("repo")?.trim().toLowerCase();
  const localRepos = repoIds.length > 0 ? await resolveLocalGithubRepos().catch(() => []) : [];
  const repoId =
    repoIds.find((id) => id.toLowerCase() === requestedRepo)?.toLowerCase() ?? repoIds[0]?.toLowerCase();
  const localRepo = repoId ? selectTaskImplementationRepo(repoId, localRepos) : null;

  return Response.json({
    id: task.id,
    date,
    text: task.text,
    done: task.done,
    stage: task.stage ?? "ready",
    abandonedAt: task.abandonedAt ?? null,
    jiraKey: task.jiraKey ?? null,
    jira: jira ? { key: jira.key, summary: jira.summary, status: jira.status.name, issuetype: jira.issuetype } : null,
    notePath,
    sourceContext: readSourceContextIfPresent(task.id),
    links,
    notes: graph.notes,
    related: graph.related,
    context: graph.expanded,
    repos: repoIds,
    repoPath: localRepo?.repo.path ?? null,
    // The assistant assigned to review the diff before commit; null means "review your own".
    reviewer: reviewerForPlan(readImplementReviewPrefs()),
  });
}
