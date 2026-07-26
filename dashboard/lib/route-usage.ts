"use client";

/**
 * Counts route visits, locally, so the "merge, delete or promote?" question
 * about `LEGACY_NAV_ITEMS` gets answered with data instead of a guess.
 *
 * Twelve routes are reachable only via ⌘K or a breadcrumb — `/appraisal`,
 * `/one-on-one`, `/research`, `/search`, `/learnings`, `/radar`, `/diagrams`,
 * `/docs`, `/shared`, `/datadog`, `/actions`, `/setup`. Each is still a page
 * plus a client, still needing tests, styling and maintenance, and mostly never
 * seen. You're running a dashboard; measure it.
 *
 * Deliberately dumb and deliberately local:
 * - `localStorage` only. No endpoint, no file, nothing leaves the machine.
 *   This is your own usage on your own laptop and it should stay that way.
 * - Counts and last-seen dates, never timestamps of individual visits. The
 *   question is "do I use this?", which needs a tally, not a history.
 * - Bounded: unknown paths collapse to their first segment, so a thousand note
 *   URLs don't become a thousand keys.
 *
 * Read it with `summariseRouteUsage()` from the ⌘K palette.
 */
const KEY = "devhub:route-usage";
/** Guard against a runaway key count if a route pattern is ever missed. */
const MAX_ROUTES = 60;

export interface RouteUsage {
  /** Visits since counting began. */
  count: number;
  /** YYYY-MM-DD of the most recent visit. */
  last: string;
}

export type RouteUsageMap = Record<string, RouteUsage>;

/**
 * Collapse a pathname to the thing we actually want to count. `/notes/a/b/c`
 * and `/notes/x` are both "did I open Library today", not two destinations.
 */
export function normaliseRoute(pathname: string): string {
  const clean = pathname.split("?")[0].replace(/\/+$/, "");
  if (!clean) return "/";
  const [, first] = clean.split("/");
  return first ? `/${first}` : "/";
}

function read(): RouteUsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as RouteUsageMap) : {};
  } catch {
    return {};
  }
}

export function recordRouteVisit(pathname: string, today: string): void {
  if (typeof window === "undefined") return;
  const route = normaliseRoute(pathname);
  const usage = read();

  // Only refuse *new* keys past the cap; existing routes keep counting.
  if (!usage[route] && Object.keys(usage).length >= MAX_ROUTES) return;

  const prev = usage[route];
  usage[route] = { count: (prev?.count ?? 0) + 1, last: today };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    /* private mode / quota — losing a tally is not worth an error */
  }
}

export function readRouteUsage(): RouteUsageMap {
  return read();
}

export function clearRouteUsage(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Busiest first, with never-visited routes listed explicitly — a route with no
 * entry is the most interesting result here, and sorting alone would hide it.
 */
export function summariseRouteUsage(known: readonly string[]): string {
  const usage = read();
  const rows = known
    .map((href) => ({ href, ...(usage[normaliseRoute(href)] ?? { count: 0, last: "never" }) }))
    .sort((a, b) => b.count - a.count || a.href.localeCompare(b.href));

  const width = Math.max(...rows.map((r) => r.href.length), 8);
  const lines = rows.map(
    (r) => `${r.href.padEnd(width)}  ${String(r.count).padStart(5)}  ${r.last}`,
  );
  const unused = rows.filter((r) => r.count === 0).map((r) => r.href);

  return [
    `route${" ".repeat(Math.max(0, width - 5))}  visits  last`,
    ...lines,
    "",
    unused.length
      ? `Never visited (${unused.length}): ${unused.join(", ")}`
      : "Every known route has been visited at least once.",
  ].join("\n");
}
