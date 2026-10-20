import { dailyNotePath, todayISO } from "./utils";
import { notesPageHref } from "./notes/path";

/** Retire presentation choices without dropping bookmarked task/filter identity. */
export function legacyTodayHref(search: string, hash = "", alias = false): string | null {
  const params = new URLSearchParams(search);
  let changed = alias;
  if (["today", "dashboard", "focus"].includes(params.get("view") ?? "")) {
    params.delete("view");
    changed = true;
  }
  let destination = "/";
  const targets: Record<string, string> = {
    tasks: "/storyboard", jira: "/work?tab=jira", tickets: "/work?tab=jira",
    history: "/work?tab=history", calendar: "/calendar", prs: "/prs", github: "/prs",
    worktrees: "/prs?tab=cleanup", notes: notesPageHref(dailyNotePath(todayISO())),
    today: "/", dashboard: "/", focus: "/",
  };
  const tab = params.get("tab");
  const anchor = hash.replace(/^#/, "");
  const target = (tab && targets[tab]) || targets[anchor];
  if (target) {
    destination = target;
    if (tab && targets[tab]) params.delete("tab");
    if (targets[anchor]) hash = "";
    changed = true;
  }
  if (!changed) return null;
  const [pathname, query] = destination.split("?");
  const output = new URLSearchParams(query);
  for (const [key, value] of params) output.append(key, value);
  return `${pathname}${output.size ? `?${output}` : ""}${hash}`;
}
