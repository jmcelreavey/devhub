import { capabilityRequest } from "./capabilities-route";
import { directToolRule } from "./tool-args";
import { commandRule } from "./ticket-args";

export type SlackListStatus = "todo" | "running" | "in-review" | "blocked" | "done";
export interface SlackRouteContext { activeProfile: string; profiles: readonly string[] }
interface ScopedRoute { profile: string }

export type RouteResult = ScopedRoute & (
  | { kind: "help" }
  | { kind: "tools"; group?: string }
  | { kind: "task"; jiraKey: string }
  | { kind: "status"; status: SlackListStatus }
  | { kind: "needs-you" }
  | { kind: "today" }
  | { kind: "auto-status" }
  | { kind: "unknown" }
  | { kind: "unknown-profile"; requested: string }
);

export function routeSlackMessage(message: string, context: SlackRouteContext): RouteResult {
  let text = message.slice(0, 4000).replace(/[’‘]/g, "'").toLowerCase().trim();
  const scope = /\bin\s+([a-z0-9][a-z0-9_-]{0,31})(?=[\s?!.,]|$)/g;
  const statusWords = new Set(["review", "progress", "to", "to-do", "todo", "running", "blocked", "done", "auto", "needs"]);
  const profiles = new Set([context.activeProfile, ...context.profiles]);
  const scopes = [...text.matchAll(scope)].filter((match) => {
    if (/^[a-z][a-z0-9_]*-[1-9][0-9]*$/.test(match[1]) && !profiles.has(match[1])) return false;
    if (!statusWords.has(match[1])) return true;
    const remainder = text.replace(match[0], "").replace(/\s+/g, " ").trim();
    return profiles.has(match[1]) && !!remainder && routeCommand(remainder, context.activeProfile).kind !== "unknown";
  });
  const requested = scopes.at(-1)?.[1];
  const profile = requested ?? context.activeProfile;
  if (requested && !profiles.has(requested)) return { kind: "unknown-profile", profile: context.activeProfile, requested };
  if (scopes.length > 1) return { kind: "unknown", profile: context.activeProfile };
  if (scopes[0]) text = text.replace(scopes[0][0], "");
  text = text.replace(/\s+/g, " ").trim();
  return routeCommand(text, profile);
}

function routeCommand(text: string, profile: string): RouteResult {
  const capabilities = capabilityRequest(text);
  if (capabilities?.kind === "overview") return { kind: "help", profile };
  if (capabilities?.kind === "tools") return { ...capabilities, profile };
  // Commands and the free views (done KEY, meetings today, my PRs) belong to the tool router, not to a status list.
  if (commandRule(text) || directToolRule(text)) return { kind: "unknown", profile };
  if (/\b(?:start|retry|resume|stop|cancel|delete|remove|approve|publish|merge|create|send|run)\b/.test(text)) return { kind: "unknown", profile };
  // Imperatives about a ticket ("move PTF-1 to …", "note PTF-1: …", "plan PTF-1") are tool commands, not status questions.
  if (/^(?:please\s+)?(?:move|mark|set|note|log|plan|implement|transition|continue|add|capture|kick off)\b/.test(text)) return { kind: "unknown", profile };
  const jira = /\b([a-z][a-z0-9_]*-[1-9][0-9]*)\b/i.exec(text);
  if (jira) return { kind: "task", profile, jiraKey: jira[1].toUpperCase() };
  if (/\b(?:needs? (?:me|you)|what'?s waiting|what is waiting|waiting (?:on|for) me)\b/.test(text)) return { kind: "needs-you", profile };
  if (/\b(?:auto status|auto mode|automation status)\b/.test(text)) return { kind: "auto-status", profile };
  if (/\btoday\b/.test(text)) return { kind: "today", profile };
  if (/^(?:what(?:'s| is| are)? )?(?:(?:are )?my tasks|my tasks today|tasks(?: today)?|what(?:'s| is) on(?: today)?)[?!.]*$/.test(text)) return { kind: "today", profile };
  if (/\b(?:to[ -]?do|todo)\b/.test(text)) return { kind: "status", profile, status: "todo" };
  if (/\b(?:running|in progress)\b/.test(text)) return { kind: "status", profile, status: "running" };
  if (/\b(?:in review|ready for review|draft pr)\b/.test(text)) return { kind: "status", profile, status: "in-review" };
  if (/\bblocked\b/.test(text)) return { kind: "status", profile, status: "blocked" };
  if (/\b(?:done|finished|completed)\b/.test(text)) return { kind: "status", profile, status: "done" };
  return { kind: "unknown", profile };
}
