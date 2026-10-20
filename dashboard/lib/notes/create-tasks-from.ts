import { parseImageMarkdownLine } from "@shared/notes-assets/markdown.ts";

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
  /**
   * Image URLs found in the body. They are `/api/notes-media/…` or notes-relative asset
   * paths, both readable from any note, so tasks link them instead of copying files.
   */
  images?: string[];
}

export interface CreateTasksFromPlanInput {
  origin: string;
  notePath: string;
  parentKey?: string;
  projectKey?: string;
  epicSummary?: string;
  repos?: string[];
  instructions?: string;
  /** User-reviewed selection; omitted only for launches without a preview. */
  workItems?: PlanWorkItem[];
}

const PR_HEADING_RE = /^(?:#{1,3}\s+)?PR\s*(\d+)\s*[—–-]\s*(.+)$/i;

const TOGGLE_RE = /^(\s*)::toggle(?:\s+(.*))?$/;
const END_TOGGLE_RE = /^\s*::end-toggle\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

function summarize(title: string): string {
  return title.length > 120 ? `${title.slice(0, 117)}…` : title;
}

/** Track an open code fence so `::toggle` inside an example is not parsed. */
function nextFence(fence: string | undefined, line: string): string | undefined {
  const match = line.match(FENCE_RE);
  if (!match) return fence;
  if (!fence) return match[1];
  return match[1][0] === fence[0] && match[1].length >= fence.length ? undefined : fence;
}

/** Index of the `::end-toggle` closing the toggle opened just before `from`, or -1. */
function findToggleEnd(lines: string[], from: number): number {
  let depth = 1;
  let fence: string | undefined;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = nextFence(fence, line);
    if (next !== fence || fence) {
      fence = next;
      continue;
    }
    if (TOGGLE_RE.test(line)) depth++;
    else if (END_TOGGLE_RE.test(line) && --depth === 0) return i;
  }
  return -1;
}

function imageUrls(text: string): string[] {
  const urls: string[] = [];
  for (const line of text.split("\n")) {
    const image = parseImageMarkdownLine(line);
    if (image) urls.push(image.path);
  }
  return urls;
}

/** Nested toggles read as bold sub-headings so `::` directives never reach a ticket. */
function describeToggleBody(lines: string[]): string {
  return lines
    .filter((line) => !END_TOGGLE_RE.test(line))
    .map((line) => {
      const nested = line.match(TOGGLE_RE);
      return nested ? `${nested[1]}**${(nested[2] ?? "").trim() || "Details"}**` : line;
    })
    .join("\n")
    .trim();
}

/**
 * A toggle is one work item with its body (text, nested lists, screenshots) as the
 * description. A toggle holding nothing but other toggles is only a group: its
 * child toggles become the items, titled "Group: child".
 */
function toggleWorkItems(title: string, body: string[]): PlanWorkItem[] {
  const children: Array<{ title: string; body: string[] }> = [];
  let hasOwnContent = false;
  let fence: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const line = body[i] ?? "";
    const next = nextFence(fence, line);
    if (next !== fence || fence) {
      fence = next;
      hasOwnContent = true;
      continue;
    }
    const toggle = line.match(TOGGLE_RE);
    if (!toggle) {
      if (line.trim()) hasOwnContent = true;
      continue;
    }
    const end = findToggleEnd(body, i + 1);
    const stop = end === -1 ? body.length : end;
    children.push({ title: (toggle[2] ?? "").trim(), body: body.slice(i + 1, stop) });
    i = stop;
  }

  if (children.length > 0 && !hasOwnContent) {
    return children.flatMap((child) => {
      const childTitle = child.title ? (title ? `${title}: ${child.title}` : child.title) : title;
      return toggleWorkItems(childTitle, child.body);
    });
  }

  const content = describeToggleBody(body);
  const heading = title || content.split("\n").find((line) => line.trim() && !parseImageMarkdownLine(line))?.trim() || "";
  if (!heading) return [];
  const description = content ? `${heading}\n${content}` : heading;
  const images = imageUrls(content);
  return [{
    id: "",
    title: heading,
    summary: summarize(heading),
    description,
    ...(images.length > 0 ? { images } : {}),
  }];
}

/** List-based notes use one top-level bullet/checklist entry per work item. */
function parseListWorkItems(lines: string[]): PlanWorkItem[] {
  const items: PlanWorkItem[] = [];
  let current: PlanWorkItem | undefined;
  let listIndent: number | undefined;
  let linksLevel: number | undefined;
  let fence: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      current = undefined;
      listIndent = undefined;
      const level = heading[1].length;
      if (linksLevel !== undefined && level <= linksLevel) linksLevel = undefined;
      if (/^links\s*#*$/i.test(heading[2].trim())) linksLevel ??= level;
      continue;
    }
    if (linksLevel !== undefined) continue;

    const toggle = line.match(TOGGLE_RE);
    const insideBullet = current !== undefined && listIndent !== undefined && (toggle?.[1].length ?? 0) > listIndent;
    if (toggle && !insideBullet) {
      const end = findToggleEnd(lines, i + 1);
      const stop = end === -1 ? lines.length : end;
      for (const item of toggleWorkItems((toggle[2] ?? "").trim(), lines.slice(i + 1, stop))) {
        items.push({ ...item, id: `item-${items.length + 1}` });
      }
      current = undefined;
      i = stop;
      continue;
    }

    const bullet = line.match(/^(\s*)(?:[-+*]|\d+[.)])(?:\s+(.*)|\s*)$/);
    if (bullet && (listIndent === undefined || bullet[1].length <= listIndent)) {
      listIndent = bullet[1].length;
      current = undefined;
      const text = (bullet[2] ?? "").trim();
      if (/^\[[xX]\](?:\s|$)/.test(text)) continue;
      const title = text.replace(/^\[ \](?:\s+|$)/, "").trim();
      if (!title) continue;
      current = {
        id: `item-${items.length + 1}`,
        title,
        summary: title.length > 120 ? `${title.slice(0, 117)}…` : title,
        description: title,
      };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.description += `\n${line}`;
    } else if (line.trim()) {
      current = undefined;
      listIndent = undefined;
    }
  }
  return items.map(withImages);
}

/** Attach image URLs and hide `::toggle` directives from indented toggles inside list items. */
function withImages(item: PlanWorkItem): PlanWorkItem {
  const description = item.description.includes("::") ? describeToggleBody(item.description.split("\n")) : item.description;
  const images = item.images ?? imageUrls(description);
  return { ...item, description, ...(images.length > 0 ? { images } : {}) };
}

/**
 * Prefer explicit PR sections; otherwise use bullets, numbered lists and checklists.
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

  if (sections.length === 0) return parseListWorkItems(lines);

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
  return items.map(withImages);
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
    "Before writing ticket titles/descriptions, task text, or note prose on the user's behalf, load the my-voice skill in full-voice mode and its writing style guide. Preserve technical facts, identifiers, links, and reproduction details.",
    "Do not mention DevHub or link to local notes/dashboard URLs in Jira titles or descriptions. Use the published plan and repository links so colleagues can read the ticket without DevHub.",
    "A parent Jira key is context only, never a work item's own key or task-text prefix. Pass parentKey to tasks_create so it cannot be inferred as the task's ticket.",
    "If Jira creation is a pending proposal, first create the DevHub task without a Jira key or key prefix. Then call integrations_propose with issue.create, parentKey and that taskId; confirmation writes the created child key back to that task. Do not create a second task after confirmation or substitute the parent's key while waiting.",
    `Plan URL (curl it first — note path, parsed work items, repos, Jira meta): ${planUrl}`,
    `Note path: ${input.notePath}`,
  ];
  if (input.parentKey?.trim()) {
    lines.push(`Parent Jira key: ${input.parentKey.trim().toUpperCase()} (create sub-tasks under this parent).`);
  } else {
    lines.push("No parent Jira key — create a parent Story/Task, then sub-tasks per work item.");
  }
  if (input.projectKey?.trim()) lines.push(`Jira project: ${input.projectKey.trim().toUpperCase()}.`);
  if (input.epicSummary?.trim()) lines.push(`Parent summary override: ${input.epicSummary.trim()}`);
  if (input.repos?.length) lines.push(`Repos: ${input.repos.join(", ")}.`);
  if (input.instructions?.trim()) lines.push(`User instructions: ${input.instructions.trim()}`);
  if (input.workItems !== undefined) {
    lines.push(
      "The user has reviewed the work items below. This list overrides workItems from the plan URL.",
      "Create tickets only for these items, using each summary exactly as the ticket title. Do not add, reword, regroup, or restore omitted items from the note or earlier instructions.",
      "Keep the supplied source descriptions and repo hints. Screenshots are `![](…)` lines in each description (also listed in `images`); copy the description into the DevHub task note unchanged so they render.",
      "If the reviewed list is empty, create nothing, including no parent ticket.",
      `Reviewed work items (JSON):\n${JSON.stringify(input.workItems, null, 2)}`,
    );
  } else {
    lines.push("By default, create one child ticket per work item, including issue bullets and checklist entries; PR headings are not required. Follow user instructions for titles and grouping. If no items were parsed, derive them from the note and instructions; ask only if still ambiguous.");
  }
  lines.push(
    "Use DevHub MCP (share_publish, tasks_create, integrations_propose, notes_read/append, entity_links_read) and Atlassian MCP (createJiraIssue, editJiraIssue) where available. Agents propose provider writes; a person confirms them in DevHub.",
    "Do not start implementation — only create, link, and report the ticket/task map.",
  );
  return lines.join("\n");
}
