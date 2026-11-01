"use client";

import useSWR, { useSWRConfig, type SWRConfiguration } from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { requestErrorMessage } from "@/lib/request-error";
import { usePanelVisible } from "@/lib/hooks/panel-visibility";
import { subscribeToTaskEvents, type Subscriber } from "@/lib/events/task-subscription";

export const defaultFetcher = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(error => {
    throw new Error(requestErrorMessage(error, "Couldn’t load this data. Retry to load it again."));
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const payload = JSON.parse(text) as { error?: unknown };
      if (typeof payload.error === "string") message = payload.error;
      else if (payload.error && typeof payload.error === "object" && "message" in payload.error && typeof payload.error.message === "string") {
        message = payload.error.message;
      }
    } catch {
      // Plain-text responses are already suitable for display.
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
};

const liveDefaults: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 0,
  dedupingInterval: 5_000,
};

function repoFromPath(path: string | undefined, pattern: RegExp): string | undefined {
  const encoded = path?.match(pattern)?.[1];
  if (!encoded) return undefined;
  try {
    const name = decodeURIComponent(encoded);
    // eslint-disable-next-line no-control-regex -- reject control characters in file names
    return !name || name.length > 255 || name === "." || name === ".." || /[\\/\x00-\x1f]/.test(name) ? undefined : name;
  } catch { return undefined; }
}

type EventBinding = Pick<Subscriber, "domains" | "repo" | "repos" | "checkout" | "content" | "plugins" | "skills" | "syncTargets" | "records" | "recall" | "docs" | "db">;
interface EventRoute {
  path: string | readonly string[] | RegExp;
  scope?: (params: URLSearchParams) => boolean;
  binding: EventBinding | ((path: string) => EventBinding | undefined);
}

const localScope = (params: URLSearchParams) => params.get("scope") === "local";
const routes: readonly EventRoute[] = [
  { path: "/api/own", scope: (p) => p.get("summary") === "1", binding: { domains: ["ownership", "git"], repos: true, records: true } },
  { path: /^\/api\/own\/[^/]+\/[^/]+\/brief$/, scope: (p) => p.get("panels") === "core", binding: { domains: ["ownership", "git"], repos: true, records: true } },
  { path: "/api/own", scope: (p) => p.get("scope") === "identity", binding: { domains: ["ownership"], records: true } },
  { path: "/api/sidebar/counts", scope: localScope, binding: { domains: ["tasks", "notes", "runs", "orchestrations", "board", "shares", "recall", "ownership"], records: true, docs: true } },
  { path: "/api/voice", binding: { domains: ["notes", "skills", "plugins"], plugins: true, skills: true } },
  { path: "/api/sync-health", binding: { domains: ["skills", "plugins"], plugins: true, skills: true, syncTargets: true } },
  { path: "/api/share", binding: { domains: ["shares", "notes", "recall"], records: true, docs: true } },
  { path: "/api/share/one-time", binding: { domains: ["shares"], records: true } },
  { path: "/api/scripts", binding: { domains: [] } },
  { path: "/api/git/conflicts", binding: { domains: ["git"], content: true } },
  { path: "/api/projects", binding: { domains: ["projects"], records: true } },
  { path: "/api/recall/index", binding: { domains: ["recall", "notes", "tasks", "conventions"], recall: true } },
  { path: "/api/recall/events", binding: { domains: ["notes"] } },
  { path: ["/api/paseo/managed", "/api/paseo/update"], binding: { domains: ["paseo"] } },
  { path: "/api/paseo/cli-updates", scope: (p) => p.get("external") !== "1", binding: { domains: ["cli-updates"], records: true } },
  { path: "/api/reps", binding: { domains: ["reps"], records: true } },
  { path: ["/api/scripts/runs", "/api/scripts/history"], binding: { domains: ["script-history"], records: true } },
  { path: "/api/skills/proposals", binding: { domains: ["skill-proposals"], records: true } },
  { path: /^\/api\/repos\/([^/]+)\/work$/, scope: localScope, binding: (path) => { const repo = repoFromPath(path, /^\/api\/repos\/([^/]+)\/work$/); return repo ? { domains: ["tasks", "notes", "git", "repo-work"], repo } : undefined; } },
  { path: /^\/api\/repos\/([^/]+)\/learn\/status$/, binding: (path) => { try { const repo = decodeURIComponent(path.match(/^\/api\/repos\/([^/]+)\/learn\/status$/)![1]); return repo ? { domains: ["notes", "git"], repo } : undefined; } catch { return undefined; } } },
  { path: /^\/api\/repos\/([^/]+)\/pr$/, scope: localScope, binding: (path) => { const repo = repoFromPath(path, /^\/api\/repos\/([^/]+)\/pr$/); return repo ? { domains: ["git"], repo } : undefined; } },
  { path: "/api/repos", binding: { domains: ["git"], repos: true } },
  { path: /^\/api\/repos\/([^/]+)$/, binding: (path) => { const repo = repoFromPath(path, /^\/api\/repos\/([^/]+)$/); return repo && !["apps", "clone", "github", "init", "worktree-cleanup", "worktree-report"].includes(repo) ? { domains: ["git"], repo } : undefined; } },
  { path: "/api/rebuild", binding: { domains: ["rebuild", "git"], checkout: true } },
  { path: "/api/conventions", binding: { domains: ["notes", "conventions"] } },
  { path: "/api/status/packaged-checkout", binding: { domains: ["git"], checkout: true } },
  { path: "/api/status/git", scope: (p) => p.get("scope") !== "external", binding: { domains: ["git"], checkout: true } },
  { path: /^\/api\/plugins\/operations\//, binding: { domains: ["plugin-operations"], plugins: true } },
  { path: "/api/plugins", binding: { domains: ["plugins", "plugin-operations"], plugins: true } },
  { path: /^\/api\/plugins\//, binding: { domains: ["plugins"], plugins: true } },
  { path: "/api/db/connections", scope: (p) => p.get("scope") !== "external", binding: { domains: ["db", "exec", "plugins"], db: true, plugins: true } },
  { path: "/api/jobs", scope: localScope, binding: { domains: ["jobs", "runs", "script-history"], records: true } },
  { path: "/api/jobs", binding: { domains: ["jobs"] } },
  { path: "/api/agent/runs/capacity", binding: { domains: ["runs"] } },
  { path: /^\/api\/agent\/runs\/[^/]+$/, binding: { domains: ["runs"] } },
  { path: "/api/status/exec", binding: { domains: ["exec"] } },
  { path: "/api/notes-media/search", binding: { domains: ["media"] } },
  { path: "/api/notes-index", scope: (params) => params.get("view") === "library", binding: { domains: ["notes", "recall"], docs: true } },
  { path: "/api/docs/tree", scope: (params) => params.has("view"), binding: { domains: ["recall"], docs: true } },
  { path: "/api/storyboard/orchestrate", binding: { domains: ["orchestrations", "runs"] } },
  { path: "/api/storyboard", binding: { domains: ["runs", "notes", "tasks", "orchestrations", "board"] } },
  { path: "/api/tasks/agent-runs/summary", binding: { domains: ["runs", "notes", "tasks"] } },
  { path: "/api/agent/runs", scope: (p) => p.get("summary") === "waiting", binding: { domains: ["runs"] } },
  { path: "/api/github/prs/auto-review", scope: localScope, binding: { domains: ["tasks", "notes", "runs"] } },
  { path: ["/api/tasks", "/api/tasks/profiles", "/api/tasks/note/sections", "/api/tasks/weekly", "/api/tasks/plan-status", "/api/tasks/implement/ready", "/api/tasks/history", "/api/tasks/note-tags", "/api/tasks/source-context", "/api/tasks/jira-intake", "/api/entity-links", "/api/tasks/failure/output", "/api/tasks/workflow"], binding: { domains: ["tasks", "notes", "runs"] } },
  { path: "/api/qa", scope: (p) => p.get("scope") === null || localScope(p), binding: { domains: ["notes"] } },
  { path: "/api/radar/personal", binding: { domains: ["notes", "ownership"], records: true } },
  { path: ["/api/notes-index", "/api/storyboard/pr-review-notes", "/api/learnings", "/api/github/prs/skip", "/api/tree", "/api/github/prs/auto-review/settings", "/api/storyboard/model-tiers", "/api/capability/radar", "/api/capability/digest", "/api/capability/journey"], binding: { domains: ["notes"] } },
  { path: "/api/collections", binding: { domains: ["collections"] } },
];

function eventBinding(key: string | null): EventBinding | undefined {
  if (!key) return undefined;
  const [path, query] = key.split("?", 2);
  const params = new URLSearchParams(query);
  for (const route of routes) {
    const matches = typeof route.path === "string" ? route.path === path : route.path instanceof RegExp ? route.path.test(path) : route.path.includes(path);
    if (!matches || (route.scope && !route.scope(params))) continue;
    return typeof route.binding === "function" ? route.binding(path) : route.binding;
  }
  return undefined;
}

export function useLive<T = unknown>(key: string | null, opts?: SWRConfiguration) {
  // Hidden keep-alive panels serve cached data until activated again.
  const visible = usePanelVisible();
  const isPaused = opts?.isPaused;
  const { cache } = useSWRConfig();
  const binding = useMemo(() => eventBinding(key), [key]);
  const [streamHealthy, setStreamHealthy] = useState(false);
  const eventPath = key?.split("?")[0];
  const repoList = eventPath === "/api/repos";
  const repoInfo = eventPath?.match(/^\/api\/repos\/[^/]+$/) && binding?.repo;
  const repEvents = eventPath === "/api/reps";
  const boardEvents = eventPath === "/api/storyboard" || (eventPath === "/api/sidebar/counts" && !!binding);
  const nonLocalJobs = eventPath === "/api/jobs" && new URLSearchParams(key?.split("?")[1]).get("scope") !== "local";
  const paseoStatus = eventPath === "/api/paseo/managed" || eventPath === "/api/paseo/update";
  // Paseo and non-local jobs also include independently changing state.
  const independentInterval = nonLocalJobs ? 60_000 : paseoStatus ? opts?.refreshInterval : undefined;
  const result = useSWR<T>(key, (opts?.fetcher ?? defaultFetcher) as (k: string) => Promise<T>, {
    ...liveDefaults,
    ...opts,
    ...(binding ? { refreshInterval: independentInterval || (streamHealthy ? 0 : 30_000) } : {}),
    isPaused: () => !visible || !!isPaused?.(),
  });
  const previouslyVisible = useRef(visible);
  const { mutate } = result;
  useEffect(() => {
    if (!binding || !visible) return;
    return subscribeToTaskEvents({
      ...binding,
      connection: setStreamHealthy,
      cache,
      key: key ?? undefined,
      refresh: () => {
        if (isPaused?.()) return false;
        void mutate().catch(() => {});
        return true;
      },
    });
  }, [binding, visible, key, mutate, isPaused, cache]);
  useEffect(() => {
    const activated = visible && !previouslyVisible.current;
    previouslyVisible.current = visible;
    if (activated && key && !isPaused?.()) void mutate();
  }, [visible, key, mutate, isPaused]);
  useEffect(() => {
    if (!repEvents || !visible || !key) return;
    let timer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const next = new Date();
      next.setHours(24, 0, 0, 0);
      timer = setTimeout(() => {
        if (!isPaused?.()) void mutate();
        scheduleMidnight();
      }, Math.max(0, next.getTime() - Date.now()));
    };
    scheduleMidnight();
    return () => clearTimeout(timer);
  }, [repEvents, visible, key, mutate, isPaused]);
  useEffect(() => {
    if ((!repoList && !repoInfo) || !visible || !key) return;
    const snapshot = result.data as { repo?: { mtimeMs: number }; repos?: { mtimeMs: number }[] } | undefined;
    const repos = snapshot?.repos ?? (snapshot?.repo ? [snapshot.repo] : []);
    const day = 86_400_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const now = Date.now();
      const deadlines = repos.filter((repo) => repo.mtimeMs > 0).map((repo) => {
        const days = Math.max(60, Math.floor((now - repo.mtimeMs) / day) + 1);
        return repo.mtimeMs + days * day;
      });
      if (!deadlines.length) return;
      timer = setTimeout(() => {
        if (document.visibilityState !== "hidden" && !isPaused?.()) void mutate().catch(() => {});
        schedule();
      }, Math.min(2_147_483_647, Math.max(1, Math.min(...deadlines) - now)));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [repoList, repoInfo, visible, key, result.data, mutate, isPaused]);
  const boardSnapshot = (result.data ?? (result.error as { board?: unknown } | undefined)?.board) as { nextChangeAt?: number; generatedAt?: string } | undefined;
  const boardDeadline = boardSnapshot?.nextChangeAt;
  const boardGeneratedAt = boardSnapshot?.generatedAt;
  useEffect(() => {
    if (!boardEvents || !visible || !key || typeof boardDeadline !== "number" || !boardGeneratedAt) return;
    const generated = Date.parse(boardGeneratedAt);
    if (!Number.isFinite(generated) || !Number.isFinite(boardDeadline)) return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== "hidden" && !isPaused?.()) void mutate().catch(() => {});
    }, Math.max(1, boardDeadline - generated));
    return () => clearTimeout(timer);
  }, [boardEvents, visible, key, boardDeadline, boardGeneratedAt, mutate, isPaused]);
  return result;
}
