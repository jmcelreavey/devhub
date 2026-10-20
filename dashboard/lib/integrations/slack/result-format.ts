import { slackLine, slackStatusLabel, type SlackCard, type SlackCardItem, type SlackCardSection } from "./format";

type Row = Record<string, unknown>;
type ToolGroup = "prs" | "tasks" | "jira" | "calendar" | "notes" | "agents" | "worktrees" | "other";
export interface ToolResultInput { tool: string; text: string; data?: unknown; args?: Row; profile: string }

const GROUP_TITLES: Record<ToolGroup, string> = { prs: "Pull requests", tasks: "Tasks", jira: "Jira tickets", calendar: "Calendar", notes: "Notes", agents: "Agent runs", worktrees: "Worktrees", other: "DevHub" };
const GROUP_PATHS: Record<ToolGroup, string> = { prs: "/prs", tasks: "/work", jira: "/work?tab=jira", calendar: "/calendar", notes: "/notes", agents: "/agents", worktrees: "/prs?tab=cleanup", other: "/" };
const PRIVATE_FIELD = /token|secret|password|credential|authorization|stack|stderr/i;

function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function field(row: Row, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? { title: String(item) } : record(item)) : [];
}

function list(data: unknown, ...keys: string[]): Row[] | undefined {
  if (Array.isArray(data)) return rows(data);
  const source = record(data);
  for (const key of keys) if (Array.isArray(source[key])) return rows(source[key]);
  return undefined;
}

function groupFor(tool: string): ToolGroup {
  if (tool.includes("worktree")) return "worktrees";
  if (tool.startsWith("prs_")) return "prs";
  if (/^(?:tasks_|task_note_|storyboard_)/.test(tool)) return "tasks";
  if (tool.startsWith("jira_")) return "jira";
  if (tool.startsWith("calendar_")) return "calendar";
  if (/^(?:notes_|docs_|search$|recall$)/.test(tool)) return "notes";
  if (/^(?:agent_|agents_)/.test(tool)) return "agents";
  return "other";
}

function titleCase(key: string): string {
  const text = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try { return valueText(JSON.parse(value)); } catch { return "Open DevHub for the details"; }
  }
  if (typeof value === "string" || typeof value === "number") return slackLine(String(value), 240);
  if (Array.isArray(value)) return value.length ? `${value.slice(0, 3).map(valueText).join(", ")}${value.length > 3 ? `, +${value.length - 3} more` : ""}` : "None";
  const item = record(value);
  return field(item, "title", "name", "summary", "text", "label", "key", "status", "state") || `${Object.keys(item).length} details`;
}

function safeTitle(text: string): string {
  return slackLine(text.replace(/https?:\/\/[^\s<>]+/g, (url) => {
    try { return new URL(url).hostname; } catch { return "Link"; }
  }), 240);
}

function metadata(row: Row, keys: string[]): string {
  return keys.flatMap((key) => row[key] === undefined || row[key] === null || row[key] === "" ? [] : [`${titleCase(key)}: ${valueText(row[key])}`]).join(" · ");
}

function genericItem(row: Row, href: string): SlackCardItem {
  const titleKey = ["title", "name", "summary", "text", "label", "path", "key", "id"].find((key) => field(row, key));
  const details = Object.keys(row).filter((key) => key !== titleKey && !PRIVATE_FIELD.test(key) && !["url", "href", "link", "status", "state"].includes(key));
  const status = field(row, "status", "state");
  return { title: safeTitle(titleKey ? field(row, titleKey) : metadata(row, details.slice(0, 2)) || "Result"), href: field(row, "url", "href", "link") || href, status: status ? slackStatusLabel(status) : undefined, meta: titleKey ? metadata(row, details.slice(0, 3)) : undefined };
}

function plainItems(text: string, href: string): SlackCardItem[] {
  const items: SlackCardItem[] = [];
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  if (/^[\[{]/.test(body)) return [{ title: "Open DevHub to see this result.", href }];
  for (const line of body.split("\n").map((value) => value.trim()).filter(Boolean)) {
    if (/^```/.test(line)) continue;
    if (/^https?:\/\/\S+$/.test(line)) {
      if (items.length) items[items.length - 1].href = line;
      else items.push({ title: "Open result", href: line });
      continue;
    }
    const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(line);
    const url = markdownLink?.[2] ?? /https?:\/\/[^\s<>]+/.exec(line)?.[0];
    const title = line.replace(/^\s*(?:[-*]\s+|#{1,6}\s+)/, "").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1").replace(/^\*\*(.*?)\*\*$/, "$1");
    items.push({ title: safeTitle(title), href: url ?? href });
  }
  return items;
}

function legacyPrs(text: string): Row | undefined {
  const result: Row = { authored: [], reviews: [] };
  let current: Row[] | undefined;
  let last: Row | undefined;
  let matched = false;
  for (const line of text.split("\n")) {
    const heading = /^(Authored|Awaiting my review) \((\d+)\):/.exec(line.trim());
    if (heading) { current = result[heading[1] === "Authored" ? "authored" : "reviews"] as Row[]; matched = true; last = undefined; continue; }
    const item = /^\s*-\s+(\S+)#(\d+)(?:\s+\[([^\]]+)\])?(\s+✓approved)?\s+(.+)$/.exec(line);
    if (item && current) {
      last = { repo: item[1], number: Number(item[2]), checks: item[3]?.split(":")[0], approved: !!item[4], title: item[5] };
      const counts = /: (\d+)✓ (\d+)✗ (\d+)…/.exec(item[3] ?? "");
      if (counts) last.checkCounts = { passed: Number(counts[1]), failed: Number(counts[2]), pending: Number(counts[3]) };
      current.push(last);
    } else if (last && /^https?:\/\/\S+$/.test(line.trim())) last.url = line.trim();
  }
  return matched ? result : undefined;
}

function prSections(data: unknown): SlackCardSection[] | undefined {
  const source = record(data);
  if (!Array.isArray(source.authored) && !Array.isArray(source.reviews)) return undefined;
  return ([["authored", "Authored", "authored"], ["reviews", "Awaiting your review", "reviews"]] as const).map(([key, title, tab]) => ({
    title, href: `/prs?tab=${tab}`, empty: key === "authored" ? "No open PRs authored by you." : "No PRs waiting for your review.",
    items: rows(source[key]).map((row) => {
      const counts = record(row.checkCounts);
      const checks = field(row, "checks");
      // Rows can arrive before checks are known; say nothing rather than claiming "no checks".
      const status = row.draft === true || row.isDraft === true ? "draft" : checks === "none" ? "no checks" : checks || undefined;
      const countMeta = ["passed", "failed", "pending"].flatMap((key) => typeof counts[key] === "number" && Number(counts[key]) > 0 ? [`${counts[key]} ${key}`] : []);
      return { title: `${field(row, "repo")}#${field(row, "number")} ${field(row, "title")}`, href: field(row, "url"), status: status ? slackStatusLabel(status) : undefined, meta: [...countMeta, ...(row.approved === true ? ["Approved"] : []), field(record(row.author), "login")].filter(Boolean).join(" · ") };
    }),
  }));
}

function legacyList(group: ToolGroup, text: string): Row[] | undefined {
  const items: Row[] = [];
  let date = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^\*\*\d{4}-\d{2}-\d{2}\*\*$/.test(trimmed)) { date = trimmed.replace(/\*/g, ""); continue; }
    if (group === "tasks") {
      const task = /^- \[([x~> ])\] (.+)$/.exec(trimmed);
      if (task) items.push({ title: task[2], status: ({ x: "done", "~": "abandoned", ">": "moved", " ": "todo" })[task[1]] });
    } else if (group === "jira") {
      const ticket = /^-?\s*([A-Z][A-Z0-9_]*-\d+) \[([^\]]+)\]\s*(.*)$/.exec(trimmed);
      if (ticket) items.push({ key: ticket[1], status: ticket[2], summary: ticket[3] });
      else if (items.length === 1 && !items[0].summary && trimmed) items[0].summary = trimmed;
    } else if (group === "calendar" && trimmed.startsWith("- ")) {
      const event = /^(all-day|\S+–\S+|\d{2}:\d{2})\s+(.+)$/.exec(trimmed.slice(2));
      items.push(event ? { title: event[2], date, start: event[1] === "all-day" ? undefined : event[1], allDay: event[1] === "all-day" } : { title: trimmed.slice(2).replace(/^\[[x ]\] /, ""), date });
    } else if (group === "notes" && trimmed.startsWith("📄 ")) {
      items.push({ path: trimmed.slice(3).trim() });
    } else if (group === "agents" && trimmed.startsWith("- ")) {
      const [id, provider, state, ...title] = trimmed.slice(2).split(" · ");
      if (title.length) items.push({ id, provider, state, title: title.join(" · ").split(" — ")[0] });
    } else if (group === "worktrees") {
      const tree = /^- (.+) — (.+?)(?: \[([^\]]+)\])?$/.exec(trimmed);
      if (tree) items.push({ path: tree[1], branch: tree[2], flags: tree[3] });
    }
  }
  return items.length ? items : undefined;
}

function taskItem(row: Row, profile: string, href: string): SlackCardItem {
  const id = field(row, "taskId", "id");
  const status = field(row, "status", "state") || (row.done === true ? "done" : row.abandonedAt ? "abandoned" : "todo");
  return { title: safeTitle(field(row, "title", "text", "summary") || "Task"), href: id ? `/storyboard?task=${encodeURIComponent(id)}&profile=${encodeURIComponent(profile)}` : href, status: slackStatusLabel(status), meta: metadata(row, ["repo", "jiraKey", "jira", "due", "openQuestions", "openBugs"]) };
}

function noteItem(row: Row, href: string): SlackCardItem {
  const notePath = field(row, "path", "notePath").replace(/\.json$/i, "");
  const target = notePath ? `/notes/${notePath.split("/").map(encodeURIComponent).join("/")}` : href;
  return { title: safeTitle(field(row, "title", "name") || notePath || field(row, "text", "snippet") || "Note"), href: field(row, "url", "href") || target, meta: metadata(row, ["snippet", "preview", "updatedAt"]) };
}

function groupItems(group: ToolGroup, items: Row[], href: string, profile: string): SlackCardItem[] {
  return items.map((row) => {
    if (group === "tasks") return taskItem(row, profile, href);
    if (group === "jira") return { title: `${field(row, "key")} ${safeTitle(field(row, "summary", "title"))}`.trim(), href: field(row, "url", "href") || href, status: slackStatusLabel(field(row, "status") || field(record(row.status), "name") || "open"), meta: metadata(row, ["issuetype", "assignee", "priority"]) };
    if (group === "calendar") return { title: safeTitle(field(row, "summary", "title", "name") || "Untitled event"), href: field(row, "htmlLink", "url", "href") || href, meta: [field(row, "date"), row.allDay === true ? "All day" : [field(row, "start"), field(row, "end")].filter(Boolean).join("–"), field(row, "location")].filter(Boolean).join(" · ") };
    if (group === "notes") return noteItem(row, href);
    if (group === "agents") {
      const id = field(row, "id", "runId");
      return { title: safeTitle(field(row, "title", "name") || "Agent run"), href: id ? `/agents?run=${encodeURIComponent(id)}` : href, status: slackStatusLabel(field(row, "state", "status") || "queued"), meta: metadata(row, ["providerLabel", "provider", "model", "createdAt"]) };
    }
    if (group === "worktrees") return { title: safeTitle([field(row, "repo"), field(row, "branch") || field(row, "path").split("/").filter(Boolean).at(-1)].filter(Boolean).join(" · ") || "Worktree"), href: row.repo ? `/repos/${encodeURIComponent(field(row, "repo"))}?tab=git` : href, meta: [field(row, "path"), field(row, "reason", "flags"), row.locked === true ? "Locked" : ""].filter(Boolean).join(" · ") };
    return genericItem(row, href);
  });
}

export function parseToolData(text: string, data?: unknown): unknown {
  if (data !== undefined) return data;
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(body); } catch { return undefined; }
}

export function toolResultCard(input: ToolResultInput): SlackCard {
  const group = groupFor(input.tool);
  const title = group === "other" ? titleCase(input.tool) : GROUP_TITLES[group];
  const notePath = typeof input.args?.path === "string" ? input.args.path.replace(/\.json$/i, "") : "";
  const href = notePath && /^(?:notes|docs)_/.test(input.tool) ? `/${input.tool.startsWith("docs_") ? "docs" : "notes"}/${notePath.split("/").map(encodeURIComponent).join("/")}`
    : input.tool.startsWith("storyboard_") ? `/storyboard?profile=${encodeURIComponent(input.profile)}` : GROUP_PATHS[group];
  const data = parseToolData(input.text, input.data);
  if (group === "prs") {
    const sections = prSections(data ?? legacyPrs(input.text));
    if (sections) return { title, profile: input.profile, href, count: sections.reduce((total, section) => total + section.items.length, 0), sections };
  }
  const removal = input.tool === "repos_worktree_cleanup" ? record(data) : undefined;
  if (removal && Array.isArray(removal.removed) && Array.isArray(removal.skipped)) {
    const folder = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
    const removed = (removal.removed as unknown[]).filter((path): path is string => typeof path === "string");
    const skipped = rows(removal.skipped);
    return {
      title, profile: input.profile, href,
      sections: [
        { title: removal.dryRun === true ? "Would remove" : "Removed", items: removed.map((path) => ({ title: safeTitle(folder(path)), meta: slackLine(path, 240) })), empty: "Nothing was removed." },
        ...(skipped.length ? [{ title: "Left alone", items: skipped.map((row) => ({ title: safeTitle([field(row, "repo"), folder(field(row, "path"))].filter(Boolean).join(" · ") || "Worktree"), meta: field(row, "reason") })) }] : []),
      ],
    };
  }
  const days = record(record(data).days);
  const calendar = group === "calendar" && Object.keys(days).length ? Object.entries(days).sort(([first], [second]) => first.localeCompare(second)).flatMap(([date, events]) => rows(events).map((event) => ({ ...event, date }))) : undefined;
  const entries = calendar ?? list(data, "cards", "tasks", "tickets", "events", "calendars", "notes", "results", "hits", "runs", "rows", "worktrees", "items") ?? legacyList(group, input.text);
  if (entries) return { title, profile: input.profile, href, count: entries.length, sections: [{ items: groupItems(group, entries, href, input.profile) }] };
  const source = record(data);
  if (group === "jira" && source.key) return { title, profile: input.profile, href, count: 1, sections: [{ items: groupItems(group, [source], href, input.profile) }] };
  const fields = Object.entries(source).filter(([key]) => !PRIVATE_FIELD.test(key));
  const items = fields.length ? fields.map(([key, value]) => ({ title: `${titleCase(key)}: ${safeTitle(valueText(value))}`, href })) : plainItems((typeof data === "string" ? data : input.text).trim() || "Done. The tool returned nothing.", href);
  return { title, profile: input.profile, href, sections: [{ items }], footer: input.text.length > 2800 ? "Showing a preview. Open in DevHub for the full result." : undefined };
}
