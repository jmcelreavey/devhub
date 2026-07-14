import { getResolvedJiraEnv, authHeader, apiBase, jsonHeaders, type ResolvedJira } from "@/lib/jira-env";

export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  priority: string;
  issuetype: string;
  project: string;
  projectKey: string;
  url: string;
  /** ISO 8601 from Jira `updated` — closest standard signal for “recently active / assigned work”. */
  updatedAt: string;
}

/** Standup slice: still assigned to you, with `updated` in the given local calendar window. */
export interface JiraStandupTicket extends JiraTicket {
  /** e.g. Done, Won't Do, or Unresolved when still open. */
  resolutionName: string;
}

interface JiraNamedField {
  name?: string;
  key?: string;
}

interface JiraIssueFields {
  summary?: string;
  status?: JiraNamedField;
  priority?: JiraNamedField;
  issuetype?: JiraNamedField;
  project?: JiraNamedField;
  updated?: string;
  resolution?: JiraNamedField | null;
}

interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

export async function getMyTickets(): Promise<JiraTicket[]> {
  const j = getResolvedJiraEnv();
  if (!j) return [];

  const res = await fetch(`${apiBase(j)}/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
      fields: ["summary", "status", "priority", "issuetype", "project", "updated"],
      maxResults: 100,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as JiraSearchResponse;

  return (data.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary ?? "",
    status: issue.fields.status?.name ?? "Unknown",
    priority: issue.fields.priority?.name ?? "None",
    issuetype: issue.fields.issuetype?.name ?? "Task",
    project: issue.fields.project?.name ?? "",
    projectKey: issue.fields.project?.key ?? "",
    url: `https://${j.domain}/browse/${issue.key}`,
    updatedAt: issue.fields.updated ?? "",
  }));
}

/**
 * Tickets **currently assigned to you** whose `updated` timestamp falls in
 * `[localStartYmd startTime, localEndYmd endTime]` in Jira's date interpretation.
 * Includes status changes and edits by anyone, not only your actions.
 */
export async function getMyAssignedTicketsTouchedInRange(
  localStartYmd: string,
  localEndYmd: string,
  startTime = "00:00",
  endTime = "23:59",
): Promise<JiraStandupTicket[]> {
  const j = getResolvedJiraEnv();
  if (!j) return [];

  const jql = `assignee = currentUser() AND updated >= "${localStartYmd} ${startTime}" AND updated <= "${localEndYmd} ${endTime}" ORDER BY updated DESC`;

  const res = await fetch(`${apiBase(j)}/search/jql`, {
    method: "POST",
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql,
      fields: ["summary", "status", "priority", "issuetype", "project", "updated", "resolution"],
      maxResults: 50,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as JiraSearchResponse;

  return (data.issues ?? []).map((issue) => {
    const resField = issue.fields.resolution;
    const resolutionName =
      resField && typeof resField === "object" && "name" in resField && resField.name
        ? String(resField.name)
        : "Unresolved";
    return {
      key: issue.key,
      summary: issue.fields.summary ?? "",
      status: issue.fields.status?.name ?? "Unknown",
      priority: issue.fields.priority?.name ?? "None",
      issuetype: issue.fields.issuetype?.name ?? "Task",
      project: issue.fields.project?.name ?? "",
      projectKey: issue.fields.project?.key ?? "",
      url: `https://${j.domain}/browse/${issue.key}`,
      updatedAt: issue.fields.updated ?? "",
      resolutionName,
    };
  });
}

export interface JiraTicketRef {
  key: string;
  summary: string;
}

export interface JiraTicketDetail {
  key: string;
  status: { name: string };
  summary: string;
  issuetype: string;
  parent: JiraTicketRef | null;
}

export async function getTicket(key: string): Promise<JiraTicketDetail | null> {
  const j = getResolvedJiraEnv();
  if (!j) return null;

  const res = await fetch(`${apiBase(j)}/issue/${key}?fields=status,summary,issuetype,parent`, {
    headers: {
      Authorization: authHeader(j),
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    key?: string;
    fields?: {
      status?: { name?: string };
      summary?: string;
      issuetype?: { name?: string };
      parent?: { key?: string; fields?: { summary?: string } };
    };
  };
  const parentRaw = data.fields?.parent;
  const parent =
    parentRaw?.key != null
      ? { key: parentRaw.key, summary: parentRaw.fields?.summary ?? "" }
      : null;
  return {
    key: data.key ?? key,
    status: { name: data.fields?.status?.name ?? "Unknown" },
    summary: data.fields?.summary ?? "",
    issuetype: data.fields?.issuetype?.name ?? "Task",
    parent,
  };
}

/* -------------------------------------------------------------------------- */
/*  Write + Agile support (create issue, transitions, board/sprint/team)      */
/* -------------------------------------------------------------------------- */

/** Atlassian Cloud Greenhopper sprint field schema marker. */
const SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint";

export interface JiraMe {
  accountId: string;
  displayName: string;
}

let _meCache: JiraMe | null = null;

/** The authenticated user (cached for the process). */
export async function getMyself(): Promise<JiraMe | null> {
  const j = getResolvedJiraEnv();
  if (!j) return null;
  if (_meCache) return _meCache;

  const res = await fetch(`${apiBase(j)}/myself`, { headers: jsonHeaders(j) });
  if (!res.ok) return null;
  const data = (await res.json()) as { accountId?: string; displayName?: string };
  if (!data.accountId) return null;
  _meCache = { accountId: data.accountId, displayName: data.displayName ?? "" };
  return _meCache;
}

interface JiraFieldDef {
  id: string;
  name: string;
  custom?: boolean;
  schema?: { custom?: string };
}

let _fieldsCache: JiraFieldDef[] | null = null;

async function getFields(j: ResolvedJira): Promise<JiraFieldDef[]> {
  if (_fieldsCache) return _fieldsCache;
  const res = await fetch(`${apiBase(j)}/field`, { headers: jsonHeaders(j) });
  if (!res.ok) return [];
  _fieldsCache = (await res.json()) as JiraFieldDef[];
  return _fieldsCache;
}

/** Custom-field id holding the Scrum sprint (e.g. customfield_10020), or null. */
async function findSprintFieldId(j: ResolvedJira): Promise<string | null> {
  const fields = await getFields(j);
  const bySchema = fields.find((f) => f.schema?.custom === SPRINT_SCHEMA);
  if (bySchema) return bySchema.id;
  const byName = fields.find((f) => f.name?.toLowerCase() === "sprint");
  return byName?.id ?? null;
}

/** Custom-field id for the Team field (Advanced Roadmaps / platform Teams), or null. */
async function findTeamFieldId(j: ResolvedJira): Promise<string | null> {
  const fields = await getFields(j);
  // Prefer an exact "Team" name; fall back to a team-ish schema marker.
  const exact = fields.find((f) => f.name?.toLowerCase() === "team");
  if (exact) return exact.id;
  const schemaish = fields.find((f) => (f.schema?.custom ?? "").toLowerCase().includes("team"));
  return schemaish?.id ?? null;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
}

export interface JiraBoard {
  id: number;
  name: string;
}

interface AgileBoardResponse {
  values?: Array<{ id: number; name: string }>;
}

interface AgileSprintResponse {
  values?: Array<{ id: number; name: string; state: string; startDate?: string }>;
}

/** First scrum board for a project, plus its active (or next future) sprint. */
export async function getBoardAndSprint(
  projectKey: string,
): Promise<{ board: JiraBoard | null; sprint: JiraSprint | null }> {
  const j = getResolvedJiraEnv();
  if (!j) return { board: null, sprint: null };

  const boardRes = await fetch(
    `https://${j.domain}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum`,
    { headers: jsonHeaders(j) },
  );
  if (!boardRes.ok) return { board: null, sprint: null };
  const boardData = (await boardRes.json()) as AgileBoardResponse;
  const rawBoard = boardData.values?.[0];
  if (!rawBoard) return { board: null, sprint: null };
  const board: JiraBoard = { id: rawBoard.id, name: rawBoard.name };

  // Active sprint first; otherwise the soonest future sprint.
  const activeRes = await fetch(
    `https://${j.domain}/rest/agile/1.0/board/${board.id}/sprint?state=active`,
    { headers: jsonHeaders(j) },
  );
  let sprint: JiraSprint | null = null;
  if (activeRes.ok) {
    const d = (await activeRes.json()) as AgileSprintResponse;
    const s = d.values?.[0];
    if (s) sprint = { id: s.id, name: s.name, state: s.state };
  }
  if (!sprint) {
    const futureRes = await fetch(
      `https://${j.domain}/rest/agile/1.0/board/${board.id}/sprint?state=future`,
      { headers: jsonHeaders(j) },
    );
    if (futureRes.ok) {
      const d = (await futureRes.json()) as AgileSprintResponse;
      const sorted = (d.values ?? []).sort((a, b) =>
        (a.startDate ?? "").localeCompare(b.startDate ?? ""),
      );
      const s = sorted[0];
      if (s) sprint = { id: s.id, name: s.name, state: s.state };
    }
  }
  return { board, sprint };
}

/** Raw value of a single field on an existing issue (used to copy the Team value). */
async function getIssueFieldRaw(key: string, fieldId: string): Promise<unknown> {
  const j = getResolvedJiraEnv();
  if (!j) return null;
  const res = await fetch(`${apiBase(j)}/issue/${key}?fields=${encodeURIComponent(fieldId)}`, {
    headers: jsonHeaders(j),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { fields?: Record<string, unknown> };
  return data.fields?.[fieldId] ?? null;
}

/** Human-readable label for whatever shape a Team field value takes. */
function teamValueLabel(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const name = o.name ?? o.title ?? o.value ?? o.displayName;
    if (typeof name === "string") return name;
  }
  return null;
}

/** Walk the parent chain until a Team value is found (epic often owns the team). */
async function inheritTeamFromChain(startKey: string, teamFieldId: string): Promise<unknown> {
  let currentKey: string | null = startKey;
  const visited = new Set<string>();

  while (currentKey && !visited.has(currentKey)) {
    visited.add(currentKey);
    const teamValue = await getIssueFieldRaw(currentKey, teamFieldId).catch(() => null);
    if (teamValueLabel(teamValue)) return teamValue;
    const ticket: JiraTicketDetail | null = await getTicket(currentKey).catch(() => null);
    currentKey = ticket?.parent?.key ?? null;
  }
  return null;
}

export interface JiraMeta {
  configured: boolean;
  domain: string;
  me: JiraMe | null;
  projectKey: string;
  board: JiraBoard | null;
  sprint: JiraSprint | null;
  sprintFieldId: string | null;
  teamFieldId: string | null;
  teamValue: unknown;
  teamLabel: string | null;
}

/**
 * Everything the "Add to Jira" modal needs to show a confirmation panel:
 * who you are, the project's board + active sprint, and the Team value copied
 * from a reference ticket. `referenceKey` (e.g. the task's current parent) lets
 * the Team value be inherited from the most relevant issue.
 */
export async function getJiraMeta(
  projectKey: string,
  referenceKey?: string,
): Promise<JiraMeta> {
  const j = getResolvedJiraEnv();
  if (!j) {
    return {
      configured: false,
      domain: "",
      me: null,
      projectKey,
      board: null,
      sprint: null,
      sprintFieldId: null,
      teamFieldId: null,
      teamValue: null,
      teamLabel: null,
    };
  }

  const [me, { board, sprint }, sprintFieldId, teamFieldId] = await Promise.all([
    getMyself(),
    getBoardAndSprint(projectKey),
    findSprintFieldId(j),
    findTeamFieldId(j),
  ]);

  // Inherit Team from the reference ticket's parent chain (epic/grandparent often
  // holds the team when the immediate parent is a bare task). Only fall back to a
  // recent assigned ticket when no reference was given.
  let teamValue: unknown = null;
  if (teamFieldId) {
    if (referenceKey) {
      teamValue = await inheritTeamFromChain(referenceKey, teamFieldId);
    } else {
      const mine = await getMyTickets().catch(() => []);
      const refKey = mine.find((t) => t.projectKey === projectKey)?.key;
      if (refKey) {
        teamValue = await inheritTeamFromChain(refKey, teamFieldId);
      }
    }
  }

  return {
    configured: true,
    domain: j.domain,
    me,
    projectKey,
    board,
    sprint,
    sprintFieldId,
    teamFieldId,
    teamValue,
    teamLabel: teamValueLabel(teamValue),
  };
}

/**
 * The Team field returns a rich object on read (`{ id, name, ... }`) but on
 * write expects just the team id. Normalize whatever shape we copied from a
 * reference ticket down to what create/update accepts.
 */
function normalizeTeamValueForWrite(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.id === "string" || typeof o.id === "number") return o.id;
  }
  return raw;
}

/* ---- Markdown → Atlassian Document Format (required by REST v3) ---- */

const ADF_INLINE_RE =
  /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;

type AdfMark = { type: string; attrs?: Record<string, unknown> };

function adfText(text: string, marks: AdfMark[]): Record<string, unknown> {
  const node: Record<string, unknown> = { type: "text", text };
  if (marks.length) node.marks = marks;
  return node;
}

/** Parse inline markdown (bold/italic/strike/code/links) into ADF text nodes. */
function parseInlineAdf(text: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  let last = 0;
  ADF_INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADF_INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(adfText(text.slice(last, m.index), []));
    if (m[2] !== undefined) nodes.push(adfText(m[2], [{ type: "strong" }, { type: "em" }]));
    else if (m[3] !== undefined) nodes.push(adfText(m[3], [{ type: "strong" }]));
    else if (m[4] !== undefined) nodes.push(adfText(m[4], [{ type: "em" }]));
    else if (m[5] !== undefined) nodes.push(adfText(m[5], [{ type: "strike" }]));
    else if (m[6] !== undefined) nodes.push(adfText(m[6], [{ type: "code" }]));
    else if (m[7] !== undefined && m[8] !== undefined)
      nodes.push(adfText(m[7], [{ type: "link", attrs: { href: m[8] } }]));
    last = ADF_INLINE_RE.lastIndex;
  }
  if (last < text.length) nodes.push(adfText(text.slice(last), []));
  return nodes.length ? nodes : [];
}

function adfParagraph(text: string): Record<string, unknown> {
  const content = parseInlineAdf(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function adfListItem(text: string): Record<string, unknown> {
  return { type: "listItem", content: [adfParagraph(text)] };
}

/** Markdown → ADF doc. Supports headings, bullet/ordered lists, and the inline marks above. */
function markdownToADF(md: string): unknown {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const content: Array<Record<string, unknown>> = [];
  let i = 0;

  const flushList = (type: "bulletList" | "orderedList", items: string[]) => {
    if (items.length) content.push({ type, content: items.map(adfListItem) });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: Math.min(heading[1].length, 6) },
        content: parseInlineAdf(heading[2]),
      });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      flushList("bulletList", items);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      flushList("orderedList", items);
      continue;
    }

    content.push(adfParagraph(trimmed));
    i++;
  }

  return {
    type: "doc",
    version: 1,
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export interface CreateIssueInput {
  projectKey: string;
  summary: string;
  description?: string;
  /** Parent issue key (epic or task). New issue's `parent` is set to this. */
  parentKey?: string | null;
  issuetypeName?: string;
  assignToMe?: boolean;
  sprintId?: number | null;
  sprintFieldId?: string | null;
  teamFieldId?: string | null;
  teamValue?: unknown;
}

export interface CreatedIssue {
  key: string;
  url: string;
}

export async function createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
  const j = getResolvedJiraEnv();
  if (!j) throw new Error("Jira is not configured.");
  const issueType = input.issuetypeName || "Task";
  const isSubtask = issueType.toLowerCase().replace(/\s+/g, "") === "sub-task";

  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    issuetype: { name: issueType },
    summary: input.summary,
  };

  if (input.description && input.description.trim()) {
    fields.description = markdownToADF(input.description);
  }
  if (input.parentKey) {
    fields.parent = { key: input.parentKey };
  }
  if (input.assignToMe) {
    const me = await getMyself();
    if (me) fields.assignee = { accountId: me.accountId };
  }
  if (!isSubtask && input.sprintFieldId && typeof input.sprintId === "number") {
    fields[input.sprintFieldId] = input.sprintId;
  }
  if (!isSubtask && input.teamFieldId && input.teamValue != null) {
    fields[input.teamFieldId] = normalizeTeamValueForWrite(input.teamValue);
  }

  const res = await fetch(`${apiBase(j)}/issue`, {
    method: "POST",
    headers: jsonHeaders(j),
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira create failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { key?: string };
  if (!data.key) throw new Error("Jira create returned no key.");
  return { key: data.key, url: `https://${j.domain}/browse/${data.key}` };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: string;
}

export async function getTransitions(key: string): Promise<JiraTransition[]> {
  const j = getResolvedJiraEnv();
  if (!j) return [];
  const res = await fetch(`${apiBase(j)}/issue/${key}/transitions`, {
    headers: jsonHeaders(j),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
  };
  return (data.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    to: t.to?.name ?? t.name,
  }));
}

export async function applyTransition(key: string, transitionId: string): Promise<void> {
  const j = getResolvedJiraEnv();
  if (!j) throw new Error("Jira is not configured.");
  const res = await fetch(`${apiBase(j)}/issue/${key}/transitions`, {
    method: "POST",
    headers: jsonHeaders(j),
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira transition failed ${res.status}: ${text}`);
  }
}
