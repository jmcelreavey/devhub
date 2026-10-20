import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { SlackTool } from "./mcp-catalog";
import { parseDay } from "./ticket-args";

export const JIRA_KEY = /\b([A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*)\b/;
// External servers may reuse $id for different schemas; never share that validator cache across schemas.
const validators = new WeakMap<object, AjvJsonSchemaValidator>();

export type ArgCheck = { ok: true; args: Record<string, unknown> } | { ok: false; problem: string; missing: string[] };

interface JsonSchemaObject { properties?: Record<string, { type?: string } | undefined>; required?: string[] }

function shape(tool: SlackTool): JsonSchemaObject {
  return tool.inputSchema as JsonSchemaObject;
}

export function requiredArgs(tool: SlackTool): string[] {
  const required = shape(tool).required;
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : [];
}

/** Validates against the tool's own input schema; anything the schema rejects goes back to John. */
export function validateToolArgs(tool: SlackTool, args: unknown): ArgCheck {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return { ok: false, problem: "The details must be an object.", missing: requiredArgs(tool) };
  const input = args as Record<string, unknown>;
  const missing = requiredArgs(tool).filter((name) => input[name] === undefined);
  try {
    let validator = validators.get(tool.inputSchema);
    if (!validator) { validator = new AjvJsonSchemaValidator(); validators.set(tool.inputSchema, validator); }
    const result = validator.getValidator<Record<string, unknown>>(tool.inputSchema)(input);
    if (result.valid) return { ok: true, args: result.data };
    const problem = result.errorMessage ?? "The details don't fit this tool.";
    // AJV also reports required fields in nested objects and selected union branches.
    const nested = [...problem.matchAll(/must have required property '([^']+)'/g)].map((match) => match[1]);
    return { ok: false, problem: problem.slice(0, 200), missing: [...new Set([...missing, ...nested])] };
  } catch { return { ok: false, problem: "This tool's input format could not be checked.", missing }; }
}

/** Preserve selected discriminators without discarding other inferred fields in the same object. */
export function mergeToolArgs(inferred: Record<string, unknown>, known: Record<string, unknown>): Record<string, unknown> {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  return Object.fromEntries([...new Set([...Object.keys(inferred), ...Object.keys(known)])].map((key) => [
    key, object(inferred[key]) && object(known[key]) ? mergeToolArgs(inferred[key], known[key]) : known[key] === undefined ? inferred[key] : known[key],
  ]));
}

/**
 * Arguments that can be read straight from the message with regex: a Jira key, the profile,
 * a search query or a "today" date. Only properties the tool declares are ever set.
 */
export function fillArgsFromText(tool: SlackTool, text: string, profile: string): Record<string, unknown> {
  const properties = shape(tool).properties ?? {};
  const required = new Set(requiredArgs(tool));
  const jira = JIRA_KEY.exec(text)?.[1].toUpperCase();
  const args: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(properties)) {
    if (definition?.type !== "string") continue;
    if (name === "profile") args[name] = profile;
    else if (jira && /^(?:jira(?:key)?|key|ticket(?:key)?|issue(?:key)?)$/i.test(name)) args[name] = jira;
    else if (required.has(name) && /^(?:query|q|search|text)$/i.test(name)) args[name] = text.trim().slice(0, 300);
    else if (required.has(name) && name === "date" && /\btoday\b/i.test(text)) args[name] = new Date().toISOString().slice(0, 10);
  }
  return args;
}

/** What a free view is about: a day's meetings (an ISO day, or "today" when none was named), the next meeting, and so on. */
export type CalendarWhen = { day: string } | { next: true };

export type DirectRoute =
  | { kind: "usage" }
  | { kind: "refresh-tools" }
  | { kind: "prs" }
  | { kind: "calendar"; when: CalendarWhen }
  | { kind: "worktrees" }
  | { kind: "time" }
  | { kind: "model" }
  | { kind: "tool"; tool: string; args: Record<string, unknown> };

const QUESTION_WORDS = ["when", "when's", "what", "whats", "what's", "is", "are", "was", "did", "does", "do", "how", "much", "many", "have", "has", "got", "i", "we", "you", "it", "the", "my", "our", "a", "an", "of", "for", "in", "on", "to", "any", "there", "show", "me", "get", "list", "tell", "give", "please", "can", "could", "so", "far", "this", "next", "today", "tomorrow", "yesterday", "tonight", "week", "month", "total", "summary", "upcoming", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const USAGE_KEYWORDS = ["cost", "costs", "usage", "spend", "spent"];
const USAGE_WORDS = ["slack", "devhub", "jev", "bot", "model", "calls", "queries", "questions", "stats"];
const CALENDAR_KEYWORDS = ["calendar", "meeting", "meetings", "event", "events"];
const CALENDAR_WORDS = ["schedule", "agenda", "diary"];
const PR_KEYWORDS = ["prs", "pr", "pull", "pulls", "requests", "reviews"];
const PR_WORDS = ["owned", "review", "mine", "authored", "open", "pending", "queue", "waiting", "need", "needs", "requested", "pipeline", "status"];
const JIRA_KEYWORDS = ["tickets", "ticket", "jira"];
const JIRA_WORDS = ["assigned", "open", "issues", "board"];
const WORKTREE_KEYWORDS = ["worktrees", "worktree"];
const WORKTREE_WORDS = ["stale", "old", "leftover", "cleanup", "clean", "up", "finished", "done", "list"];

/**
 * True only when the whole message is the question: the keyword plus filler like "what's my … today".
 * A keyword inside something longer ("note PTF-1: cost was high") is somebody's note, not a question.
 */
function wholeIntent(lower: string, keywords: readonly string[], extra: readonly string[]): boolean {
  const words = lower.split(/[^a-z0-9']+/).filter(Boolean);
  const allowed = new Set([...QUESTION_WORDS, ...keywords, ...extra]);
  return words.some((word) => keywords.includes(word)) && words.every((word) => allowed.has(word));
}

/** Free keyword rules for obvious one-tool questions. Only read-only tools are ever called from here. */
export function directToolRule(text: string, now = new Date()): DirectRoute | null {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  if (wholeIntent(lower, USAGE_KEYWORDS, USAGE_WORDS)) return { kind: "usage" };
  if (/^(?:hey |so )?(?:what(?:'?s| is) the (?:time|date)(?: now| today)?|what time is it(?: now)?|what(?:'s| is) (?:the )?date today|what day is it(?: today)?|time|date)[?!.]*$/.test(lower.trim())) return { kind: "time" };
  if (/^(?:hey |so )?(?:what|which)(?:'s| is)? (?:ai )?(?:model|llm)(?: are you| do you| is this)?(?: using| running| use)?[?!.]*$/.test(lower.trim())) return { kind: "model" };
  if (/\b(?:refresh|reload|update)\b.*\b(?:tools?|catalog)\b/.test(lower)) return { kind: "refresh-tools" };
  const direct = (tool: string, args: Record<string, unknown> = {}): DirectRoute => ({ kind: "tool", tool, args });
  if (wholeIntent(lower, CALENDAR_KEYWORDS, CALENDAR_WORDS)) {
    if (/\bweek\b/.test(lower)) return direct("calendar_week");
    if (/\bnext\b/.test(lower) && !parseDay(lower, now)) return { kind: "calendar", when: { next: true } };
    return { kind: "calendar", when: { day: parseDay(lower, now) ?? parseDay("today", now)! } };
  }
  if (wholeIntent(lower, PR_KEYWORDS, PR_WORDS)) return { kind: "prs" };
  if (wholeIntent(lower, JIRA_KEYWORDS, JIRA_WORDS)) return direct("jira_tickets");
  // "What tasks are assigned to me?" means Jira tickets assigned to John.
  if (/\bassigned to me\b/.test(lower) && lower.split(/\s+/).length <= 8 && !/\b(?:add|create|move|mark|note|start|plan|delete)\b/.test(lower)) return direct("jira_tickets");
  if (/^my assigned tasks[?!.]*$/.test(lower.trim())) return direct("jira_tickets");
  if (wholeIntent(lower, WORKTREE_KEYWORDS, WORKTREE_WORDS)) return { kind: "worktrees" };
  if (/\bbriefing\b/.test(lower)) return direct("briefing_get");
  if (/\bstand-?up\b/.test(lower)) return direct("standup_markdown");
  if (/\b(?:scheduled jobs|jobs)\b/.test(lower)) return direct("jobs_list");
  if (/\b(?:agent runs|running agents|agents running)\b/.test(lower)) return direct("agent_runs");
  if (/\b(?:services|dashboard) status\b/.test(lower)) return direct("status_services");
  const search = /\bsearch(?: for)?\s+(.{2,200})$/i.exec(text.trim());
  if (search) return direct("search", { query: search[1].replace(/[?!.]+$/, "").trim() });
  return null;
}
