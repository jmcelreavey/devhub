export interface PlanWorkItem {
  /** Stable id such as `pr-1`. */
  id: string;
  /** Full heading line. */
  title: string;
  /** Short summary for Jira/DevHub task text. */
  summary: string;
  /** Repo name hint parsed from the heading (e.g. WebApp). */
  repoHint?: string;
  /** Section body markdown (trimmed). */
  description: string;
}

export interface CreateTasksFromPlanInput {
  origin: string;
  notePath: string;
  parentKey?: string;
  projectKey?: string;
  epicSummary?: string;
  repos?: string[];
}

const PR_HEADING_RE = /^(?:#{1,3}\s+)?PR\s*(\d+)\s*[—–-]\s*(.+)$/i;

/**
 * Split a planning note into PR-sized work items from `PR N — …` headings.
 * Falls back to level-2 headings that mention PR when no numbered PR headings exist.
 */
export function parsePlanWorkItems(markdown: string): PlanWorkItem[] {
  const lines = markdown.split("\n");
  const sections: Array<{ level: number; title: string; start: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const hash = line.match(/^(#{1,3})\s+(.+)$/);
    if (!hash) continue;
    const level = hash[1].length;
    const title = hash[2].trim();
    if (!title) continue;
    const isPr = PR_HEADING_RE.test(title) || /^PR\s*\d+/i.test(title);
    if (!isPr && level > 2) continue;
    if (!isPr && !/^PR\b/i.test(title)) continue;
    sections.push({ level, title, start: i + 1 });
  }

  if (sections.length === 0) return [];

  const items: PlanWorkItem[] = [];
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s]!;
    const next = sections[s + 1];
    const bodyLines = lines.slice(section.start, next?.start != null ? next.start - 1 : lines.length);
    const description = bodyLines.join("\n").trim();
    const prMatch = section.title.match(PR_HEADING_RE);
    const prNum = prMatch?.[1] ?? String(s + 1);
    const afterDash = prMatch?.[2]?.trim() ?? section.title.replace(/^#+\s*/, "");
    const repoHint = afterDash.split(":")[0]?.trim();
    const summary = afterDash.length > 120 ? `${afterDash.slice(0, 117)}…` : afterDash;
    items.push({
      id: `pr-${prNum}`,
      title: section.title.replace(/^#+\s*/, ""),
      summary,
      repoHint: repoHint && repoHint.length < 80 ? repoHint : undefined,
      description,
    });
  }
  return items;
}

export function planTitleFromMarkdown(markdown: string, notePath: string): string {
  for (const line of markdown.split("\n")) {
    const m = line.match(/^#\s+(.+)$/);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  const leaf = notePath.split("/").pop() ?? notePath;
  return leaf.replace(/-/g, " ");
}

export function createTasksPlanUrl(input: CreateTasksFromPlanInput): string {
  const base = input.origin.replace(/\/$/, "");
  const params = new URLSearchParams({ notePath: input.notePath });
  if (input.parentKey?.trim()) params.set("parentKey", input.parentKey.trim().toUpperCase());
  if (input.projectKey?.trim()) params.set("projectKey", input.projectKey.trim().toUpperCase());
  if (input.epicSummary?.trim()) params.set("epicSummary", input.epicSummary.trim());
  for (const repo of input.repos ?? []) {
    const r = repo.trim();
    if (r) params.append("repo", r);
  }
  return `${base}/api/notes/create-tasks/plan?${params.toString()}`;
}

/**
 * Build the agent launch prompt for the devhub-create-tasks-from skill.
 */
export function buildCreateTasksFromPrompt(input: CreateTasksFromPlanInput): string {
  const planUrl = createTasksPlanUrl(input);
  const lines = [
    "Use the devhub-create-tasks-from skill to turn this planning note into Jira sub-tasks and DevHub tasks with full entity linking.",
    `Plan URL (curl it first — note path, parsed work items, repos, Jira meta): ${planUrl}`,
    `Note path: ${input.notePath}`,
  ];
  if (input.parentKey?.trim()) {
    lines.push(`Parent Jira key: ${input.parentKey.trim().toUpperCase()} (create sub-tasks under this parent).`);
  } else {
    lines.push("No parent Jira key — create a parent Story/Task for the epic, then sub-tasks per work item.");
  }
  if (input.projectKey?.trim()) lines.push(`Jira project: ${input.projectKey.trim().toUpperCase()}.`);
  if (input.epicSummary?.trim()) lines.push(`Parent summary override: ${input.epicSummary.trim()}`);
  if (input.repos?.length) lines.push(`Repos: ${input.repos.join(", ")}.`);
  lines.push(
    "Use DevHub MCP (share_publish, tasks_create, notes_read/append, entity_links_read) and Atlassian MCP (createJiraIssue, editJiraIssue) where available.",
    "Do not start implementation — only create, link, and report the ticket/task map.",
  );
  return lines.join("\n");
}
