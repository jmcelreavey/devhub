import type { SlackTool } from "./mcp-catalog";

/**
 * Deterministic argument extraction for Slack messages: ticket keys, task ids, PR refs, URLs,
 * enum keywords and days. No model is ever called here.
 */

export interface PrRef { repo?: string; number: number; url?: string }
export interface MessageRefs { jiraKeys: string[]; taskIds: string[]; taskDates: Record<string, string>; prs: PrRef[]; urls: string[] }
/** One DevHub task a ticket key or id points at. */
export interface SlackTaskMatch { taskId: string; date: string; title: string; profile: string; done?: boolean; own?: boolean; /** An agent or auto run is still going on it. */ running?: boolean }

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const NOTE_PATH = /\btask-notes\/(\d{4}-\d{2}-\d{2})-([A-Za-z0-9_-]{1,128})\b/g;
const JIRA_UPPER = /\b([A-Z][A-Z0-9]+-[1-9][0-9]*)\b/g;
const JIRA_ANY = /\b([A-Za-z][A-Za-z0-9]{1,9}-[1-9][0-9]*)\b/g;
const PR_URL = /\bhttps?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)\b[^\s>|]*/gi;
const PR_SHORT = /(?:^|[\s(])((?:[\w.-]+\/)?[\w.-]+)#([1-9][0-9]*)\b/g;
const URL = /\bhttps?:\/\/[^\s<>|]+/gi;

/** Slack wraps links as <url|label> and mentions as <@U…>; read the plain text underneath. */
export function plainSlackText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, " ").replace(/<((?:https?|mailto):[^|>]+)(?:\|[^>]*)?>/g, "$1").replace(/[’‘]/g, "'").replace(/[“”]/g, "\"");
}

const unique = <Value>(values: Value[]): Value[] => [...new Set(values)];

export function extractRefs(raw: string): MessageRefs {
  const text = plainSlackText(raw);
  const taskDates: Record<string, string> = {};
  const fromPaths = [...text.matchAll(NOTE_PATH)].map((match) => { taskDates[match[2]] = match[1]; return match[2]; });
  const taskIds = unique([...fromPaths, ...[...text.matchAll(UUID)].map((match) => match[0].toLowerCase())]);
  const urls = unique([...text.matchAll(URL)].map((match) => match[0].replace(/[).,!?]+$/, "")));
  const prs: PrRef[] = [];
  for (const match of text.matchAll(PR_URL)) prs.push({ repo: match[1], number: Number(match[2]), url: `https://github.com/${match[1]}/pull/${match[2]}` });
  const bare = text.replace(URL, " ").replace(NOTE_PATH, " ").replace(UUID, " ");
  for (const match of bare.matchAll(PR_SHORT)) {
    if (prs.some((pr) => pr.number === Number(match[2]))) continue;
    prs.push({ ...(match[1].includes("/") ? { repo: match[1] } : {}), number: Number(match[2]) });
  }
  const upper = [...bare.matchAll(JIRA_UPPER)].map((match) => match[1]);
  const jiraKeys = unique((upper.length ? upper : [...bare.matchAll(JIRA_ANY)].map((match) => match[1].toUpperCase())));
  return { jiraKeys, taskIds, taskDates, prs, urls };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** today, tomorrow, yesterday, (next|last) <weekday>, YYYY-MM-DD. Local time, like DevHub's day files. */
export function parseDay(raw: string, now = new Date()): string | undefined {
  const text = raw.toLowerCase();
  const explicit = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (explicit) {
    const date = new Date(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3]));
    return iso(date) === explicit[0] ? explicit[0] : undefined;
  }
  const shift = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  if (/\b(?:today|tonight)\b/.test(text)) return shift(0);
  if (/\btomorrow\b/.test(text)) return shift(1);
  if (/\byesterday\b/.test(text)) return shift(-1);
  const weekday = new RegExp(`\\b(?:(next|last|this)\\s+)?(${WEEKDAYS.join("|")})\\b`).exec(text);
  if (!weekday) return undefined;
  const delta = (WEEKDAYS.indexOf(weekday[2]) - now.getDay() + 7) % 7;
  if (weekday[1] === "last") return shift(delta === 0 ? -7 : delta - 7);
  if (weekday[1] === "next") return shift(delta === 0 ? 7 : delta);
  return shift(delta);
}

/** Words that mean an enum value, beyond the value itself. */
const SYNONYMS: Record<string, string[]> = {
  complete: ["done", "finished", "complete", "completed"],
  abandon: ["abandon", "abandoned", "drop", "dropped"],
  reactivate: ["reopen", "reactivate", "undo"],
  ready: ["ready", "ready to implement"],
  draft: ["draft", "back to draft"],
  manual: ["manual", "manually"],
  heavy: ["heavy", "best", "strongest"],
  cheap: ["cheap", "cheapest", "light"],
  mid: ["mid", "medium"],
};

function wordPattern(word: string): RegExp {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-_ ]+/g, "[-_ ]?");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`);
}

/** The one enum value the message names, or undefined when it names none or several. */
export function enumFromText(values: readonly string[], raw: string): string | undefined {
  const text = plainSlackText(raw).toLowerCase();
  const hits = values.filter((value) => [value, ...(SYNONYMS[value] ?? [])].some((word) => wordPattern(word).test(text)));
  const kept = hits.filter((value) => !hits.some((other) => other !== value && other.includes(value)));
  return kept.length === 1 ? kept[0] : undefined;
}

interface Property { type?: string | string[]; enum?: unknown[]; description?: string }
function properties(tool: SlackTool): Record<string, Property> {
  return ((tool.inputSchema as { properties?: Record<string, Property> }).properties) ?? {};
}
function required(tool: SlackTool): Set<string> {
  const list = (tool.inputSchema as { required?: unknown }).required;
  return new Set(Array.isArray(list) ? list.filter((name): name is string => typeof name === "string") : []);
}
const isType = (property: Property, type: string) => property.type === type || (Array.isArray(property.type) && property.type.includes(type));

/** The task-id field this tool takes: taskId, or `id` when it is described as a task id. */
export function taskIdField(tool: SlackTool): string | undefined {
  const props = properties(tool);
  if (props.taskId && isType(props.taskId, "string")) return "taskId";
  if (props.id && isType(props.id, "string") && /\btask\b/i.test(props.id.description ?? "") && !/\bitem\b/i.test(props.id.description ?? "")) return "id";
  return undefined;
}

const ENUM_OPTIONAL = /^(?:stage|status|mode|action|tier|ui)$/;
const DAY_FIELDS = /^(?:date|day|due|taskDate|startDate)$/;

/**
 * Arguments read from the message without a model: enum keywords, days, PR refs and URLs, plus
 * the resolved task's id and day. Only properties the tool declares are set.
 */
export function extractToolArgs(tool: SlackTool, rawText: string, task?: SlackTaskMatch, now = new Date()): Record<string, unknown> {
  const text = plainSlackText(rawText);
  const refs = extractRefs(text);
  const props = properties(tool);
  const needed = required(tool);
  const args: Record<string, unknown> = {};
  const idField = taskIdField(tool);
  if (task && idField) args[idField] = task.taskId;
  const day = parseDay(text, now);
  const pr = refs.prs[0];
  for (const [name, property] of Object.entries(props)) {
    if (!property || name in args) continue;
    if (Array.isArray(property.enum) && property.enum.every((value) => typeof value === "string")) {
      if (!needed.has(name) && !ENUM_OPTIONAL.test(name)) continue;
      const value = enumFromText(property.enum as string[], text);
      if (value !== undefined) args[name] = value;
      continue;
    }
    if (isType(property, "string") && DAY_FIELDS.test(name)) {
      if (task && idField && (name === "taskDate" || name === "date")) args[name] = task.date;
      else if (day && (needed.has(name) || name === "due" || !idField)) args[name] = day;
      continue;
    }
    if (pr && name === "repo" && isType(property, "string") && pr.repo) args[name] = pr.repo;
    else if (pr && /^(?:number|prNumber|pr)$/.test(name) && isType(property, "integer")) args[name] = pr.number;
    else if (/^(?:url|prUrl|link|href)$/.test(name) && isType(property, "string")) {
      const url = (/pull|\bpr\b/i.test(`${name} ${property.description ?? ""}`) && pr?.url) || (needed.has(name) ? refs.urls[0] : undefined);
      if (url) args[name] = url;
    }
  }
  return args;
}

/** Which task a "done …" / "reopen …" points at: a ticket key, a task id, or words from its title. */
export interface TaskTarget { key?: string; taskId?: string; words?: string }

export type CommandRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown>; note?: string }
  | { kind: "transition"; key: string; target: string }
  | { kind: "task-state"; state: "done" | "open"; target: TaskTarget }
  | { kind: "capture"; text: string };

const REF = "([A-Za-z][A-Za-z0-9]{1,9}-[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const LEAD = "^(?:please\\s+|can you\\s+|could you\\s+)?";
export const PLAN_ONLY_NOTE = "Plan only — stops after the plan. Codex uses a read-only sandbox; Claude uses plan permissions. Other providers rely on their planning mode or instructions, not a guaranteed write sandbox.";
/** What follows "done" / "todo" when the message is really a status question ("done today", "todo list"). */
const STATUS_TAIL = /^(?:(?:for|in|on|with)\s+)?(?:today|yesterday|tomorrow|this week|last week|this month|tasks?|items?|list|all|recently|so far|now|please)\??$/i;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function taskTarget(raw: string): TaskTarget | null {
  const words = raw.replace(/^(?:with|the|off)\s+/i, "").replace(/[?!.]+$/, "").trim();
  if (words.length < 2 || STATUS_TAIL.test(words)) return null;
  if (UUID_ONLY.test(words)) return { taskId: words.toLowerCase() };
  const ref = new RegExp(`^${REF}$`, "i").exec(words);
  if (ref) return { key: ref[1].toUpperCase() };
  // "complete it" / "done so" name no task; they would match half the board.
  return words.replace(/[^a-z0-9]/gi, "").length >= 3 ? { words: words.slice(0, 120) } : null;
}

/**
 * Free routes for the commonest ticket commands, so they skip Jev entirely. Every write still stops at
 * a Confirm card except the reversible ones (done, reopen, add task), which run at once with an Undo.
 */
export function commandRule(rawText: string): CommandRoute | null {
  const ownerNote = new RegExp(`${LEAD}(?:note|add (?:a )?note (?:to|on))\\s+${REF}(?:\\s*[:\\-–]\\s*|\\s+)([\\s\\S]+)$`, "i").exec(rawText.trim());
  if (ownerNote?.[2].trim()) return { kind: "tool", tool: "task_note_add", args: { id: ownerNote[1], text: ownerNote[2].trim() } };
  const text = plainSlackText(rawText).replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  const lower = text.toLowerCase();
  const match = (pattern: string) => new RegExp(LEAD + pattern + "$", "i").exec(lower);
  let found: RegExpExecArray | null;
  if ((found = match(`(?:start|kick off|run)\\s+${REF}(?:\\s+(?:on|in|with|using)\\s+(auto|auto mode|autopilot))?`))) return { kind: "tool", tool: "storyboard_start_auto", args: {} };
  if ((found = match(`(?:start\\s+${REF}\\s+(?:on|in|with)\\s+(?:plan|planning|plan mode)|(?:start\\s+)?plan(?:ning)?\\s+${REF}|start\\s+planning\\s+${REF})`))) return { kind: "tool", tool: "tasks_agent_plan", args: {}, note: PLAN_ONLY_NOTE };
  if ((found = match(`(?:implement|start implementing|resume|continue)\\s+${REF}`))) return { kind: "tool", tool: "tasks_agent_resume", args: {} };
  if ((found = match(`(?:mark|set|move)\\s+${REF}\\s+(?:as\\s+|(?:back\\s+)?to\\s+)?(ready|draft)`))) return { kind: "tool", tool: "tasks_set_stage", args: { stage: found[2] } };
  if ((found = match(`mark\\s+${REF}\\s+(?:as\\s+)?(?:done|complete|completed|finished)`))) return { kind: "task-state", state: "done", target: taskTarget(found[1])! };
  if ((found = match(`(?:move|transition|set)\\s+${REF}\\s+(?:to|into|as)\\s+(.{2,60})`))) {
    const key = found[1].toUpperCase();
    return /^[A-Z]/.test(key) ? { kind: "transition", key, target: text.slice(text.length - found[2].length).trim() } : null;
  }
  const note = new RegExp(`${LEAD}log\\s+${REF}\\s*[:\\-–]\\s*(.+)$`, "i").exec(text);
  if (note) return { kind: "tool", tool: "task_note_update", args: { op: "append_log", message: note[2].trim().slice(0, 2000) } };
  if (new RegExp(`${LEAD}(?:re-?open|reactivate)\\s+${REF}\\s+and\\s+address\\s+feedback$`, "i").test(text)) return { kind: "tool", tool: "task_reopen", args: { addressFeedback: true }, note: "Reopens the task and starts an agent for new PR feedback." };
  const state = new RegExp(`${LEAD}(done|finish|complete|tick off|check off|re-?open|reactivate)\\s+(.{2,140})$`, "i").exec(text);
  if (state) {
    const target = taskTarget(state[2]);
    if (target) return { kind: "task-state", state: /^(?:done|finish|complete|tick off|check off)$/i.test(state[1]) ? "done" : "open", target };
  }
  // "task: …" needs its colon (plain "task done" is a question); "todo …" and "add task …" don't.
  const capture = new RegExp(`${LEAD}(?:(?:add|new|create)\\s+(?:a\\s+|an\\s+)?(?:new\\s+)?(?:task|todo|to-do)\\s*[:\\-–]?|todo\\s*[:\\-–]?|task\\s*:)\\s*(.{2,})$`, "i").exec(text);
  if (capture && !STATUS_TAIL.test(capture[1].trim())) return { kind: "capture", text: capture[1].trim().slice(0, 500) };
  return null;
}

/** Transition id whose name matches the target, from jira_ticket_transition's listing text. */
export function parseTransitions(text: string): Array<{ id: string; name: string }> {
  return [...text.matchAll(/^- ([^:\n]+): (.+)$/gm)].map((match) => ({ id: match[1].trim(), name: match[2].trim() }));
}

export function matchTransition(transitions: ReadonlyArray<{ id: string; name: string }>, target: string): { id: string; name: string } | undefined {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = norm(target);
  const exact = transitions.filter((item) => norm(item.name) === wanted);
  if (exact.length === 1) return exact[0];
  const partial = transitions.filter((item) => norm(item.name).includes(wanted) || wanted.includes(norm(item.name)));
  return partial.length === 1 ? partial[0] : undefined;
}

/** The best candidates for a ticket: its own task before tasks that only link the key, open before done. */
export function rankTaskMatches(matches: readonly SlackTaskMatch[]): SlackTaskMatch[] {
  if (matches.length <= 1) return [...matches];
  const own = matches.filter((match) => match.own);
  const pool = own.length ? own : [...matches];
  const open = pool.filter((match) => !match.done);
  return open.length ? open : pool;
}
