"use client";

import { useEffect, useMemo, useState } from "react";
import { GitBranch, ExternalLink, MonitorPlay, AlertCircle, ArrowUpFromLine, Monitor, RefreshCw, Download, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { FetchError } from "@/components/FetchError";
import { HoverTip } from "@/components/HoverTip";

interface RepoInfo {
  name: string;
  path: string;
  branch: string | null;
  dirtyCount: number;
  remote: string | null;
  unpushedCount?: number;
}

interface ReposApiPayload {
  repos: RepoInfo[];
  scanDirDisplay: string;
}

interface GithubRepoInfo {
  name: string;
  fullName: string;
  owner: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string | null;
  localRepoName: string | null;
}

interface GithubReposApiPayload {
  repos: GithubRepoInfo[];
}

function parseFetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Couldn’t load GitHub repos.";
  const raw = error.message;
  const marker = ": ";
  const bodyIndex = raw.indexOf(marker);
  if (bodyIndex === -1) return raw;
  const maybeJson = raw.slice(bodyIndex + marker.length).trim();
  try {
    const parsed = JSON.parse(maybeJson) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // Ignore parse failures and fall back to raw message.
  }
  return raw;
}

function githubUrl(remote: string | null) {
  if (!remote) return null;
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}` : null;
}

export default function ReposPage() {
  const {
    data,
    isLoading,
    error: localError,
    mutate: mutateLocal,
    isValidating: isLocalValidating,
  } = useLive<ReposApiPayload>("/api/repos");
  const repos = data?.repos ?? [];
  const [query, setQuery] = useState("");
  const [debouncedGithubQuery, setDebouncedGithubQuery] = useState("");
  const githubSearchQuery = debouncedGithubQuery.trim();
  const githubKey = useMemo(
    () => (githubSearchQuery ? `/api/repos/github${queryParam(githubSearchQuery)}` : null),
    [githubSearchQuery],
  );
  const {
    data: githubData,
    error: githubError,
    mutate: mutateGithub,
    isValidating: isGithubValidating,
  } = useLive<GithubReposApiPayload>(githubKey, { refreshInterval: 120_000 });
  const scanDirDisplay = data?.scanDirDisplay ?? "";
  const [opening, setOpening] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });
  const toast = useToast();
  const githubRepos = githubData?.repos ?? [];
  const normalizedLocalQuery = query.trim().toLowerCase();
  const filteredLocalRepos = normalizedLocalQuery
    ? repos.filter((repo) => repo.name.toLowerCase().includes(normalizedLocalQuery))
    : repos;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedGithubQuery(query);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  async function openInCursor(name: string) {
    setOpening(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("open in cursor:", e);
      toast.error(`Couldn't open ${name} in Cursor.`);
    } finally {
      setOpening(null);
    }
  }

  async function cloneRepo(fullName: string) {
    setCloning(fullName);
    try {
      const res = await fetch("/api/repos/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      if (!res.ok) throw new Error(await res.text());
      await Promise.all([mutateLocal(), mutateGithub()]);
      toast.success(`Cloned ${fullName}`);
    } catch (e) {
      console.error("clone repo:", e);
      toast.error(`Couldn't clone ${fullName}.`);
    } finally {
      setCloning(null);
    }
  }

  async function removeRepo(name: string) {
    const ok = window.confirm(`Remove local repo "${name}"? This will delete the local folder only.`);
    if (!ok) return;
    setRemoving(name);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await Promise.all([mutateLocal(), mutateGithub()]);
      toast.success(`Removed ${name}`);
    } catch (e) {
      console.error("remove repo:", e);
      toast.error(`Couldn't remove ${name}.`);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="page-title">Repos</div>
        <div className="flex items-center gap-2">
          <span className="badge badge-muted">{repos.length}</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => {
              void mutateLocal();
              void mutateGithub();
            }}
            disabled={isLocalValidating || isGithubValidating}
            aria-label="Refresh repos"
          >
            <RefreshCw size={12} className={isLocalValidating || isGithubValidating ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      {localError && (
        <div className="card card-body mb-3" style={{ borderLeft: "3px solid var(--danger)" }}>
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <AlertCircle size={14} style={{ color: "var(--danger)" }} aria-hidden />
            Couldn&apos;t load local repos.
            <button type="button" className="btn btn-ghost ml-auto" onClick={() => mutateLocal()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="mb-2">
        <OpenChamberCard />
      </div>

      {isLoading && !data && (
        <div className="space-y-2 mb-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius)" }} />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="repos-filter" className="sr-only">Search repos</label>
        <input
          id="repos-filter"
          className="input mb-2"
          placeholder="Search GitHub and filter local repos..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="pt-2">
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--text-subtle)" }}>
            GitHub {githubSearchQuery ? `(${isGithubValidating && !githubData ? "…" : githubRepos.length})` : "(search to load)"}
          </div>
        </div>

        {githubError && (
          <FetchError message={parseFetchErrorMessage(githubError)} onRetry={() => mutateGithub()} />
        )}
        {githubSearchQuery && isGithubValidating && !githubData && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Searching GitHub repos...
          </p>
        )}

        {githubSearchQuery && githubRepos.map((repo) => (
          <div key={repo.fullName} className="card" style={{ padding: "12px 16px" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm mb-0.5 break-words leading-snug" style={{ color: "var(--text)" }}>
                  {repo.fullName}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {repo.defaultBranch && (
                    <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-subtle)" }}>
                      <GitBranch size={11} /> {repo.defaultBranch}
                    </span>
                  )}
                  {repo.isPrivate && <span className="badge badge-muted" style={{ fontSize: "10px" }}>private</span>}
                  {repo.localRepoName && (
                    <span className="badge badge-success" style={{ fontSize: "10px" }}>
                      Local: {repo.localRepoName}
                    </span>
                  )}
                </div>
                {repo.description && (
                  <div className="text-xs mt-1 break-words leading-snug" style={{ color: "var(--text-subtle)" }}>
                    {repo.description}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "3px 8px" }}
                >
                  <ExternalLink size={12} /> GitHub
                </a>
                {repo.localRepoName ? (
                  isDesktop && (
                    <button
                      onClick={() => openInCursor(repo.localRepoName!)}
                      disabled={opening !== null}
                      className="btn btn-ghost"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                    >
                      <MonitorPlay size={12} />
                      {opening === repo.localRepoName ? "Opening…" : "Cursor"}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: "12px", padding: "3px 8px" }}
                    disabled={cloning !== null}
                    onClick={() => cloneRepo(repo.fullName)}
                  >
                    <Download size={12} />
                    {cloning === repo.fullName ? "Cloning…" : "Clone"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {!githubSearchQuery && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Type in the GitHub box to search repos.
          </p>
        )}
        {githubSearchQuery && !isGithubValidating && !githubError && githubRepos.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No GitHub repos matching &quot;{githubSearchQuery}&quot;.
          </p>
        )}

        <div className="pt-1">
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--text-subtle)" }}>
            Local ({filteredLocalRepos.length}/{repos.length})
          </div>
        </div>

        {filteredLocalRepos.map((repo) => {
          const ghUrl = githubUrl(repo.remote);
          return (
            <div key={repo.name} className="card" style={{ padding: "12px 16px" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm mb-0.5 break-words leading-snug" style={{ color: "var(--text)" }}>
                    {repo.name}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {repo.branch && (
                      <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-subtle)" }}>
                        <GitBranch size={11} /> {repo.branch}
                      </span>
                    )}
                    {repo.dirtyCount > 0 && (
                      <span className="badge badge-warning" style={{ fontSize: "10px" }}>
                        <AlertCircle size={10} /> {repo.dirtyCount} changed
                      </span>
                    )}
                    {(repo.unpushedCount ?? 0) > 0 && (
                      <span
                        className="repo-unpushed-badge"
                        title="Local commits not on any remote"
                      >
                        <ArrowUpFromLine size={10} aria-hidden /> {repo.unpushedCount} unpushed
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {ghUrl && (
                    <a
                      href={ghUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                    >
                      <ExternalLink size={12} /> GitHub
                    </a>
                  )}
                  {isDesktop && (
                    <button
                      onClick={() => openInCursor(repo.name)}
                      disabled={opening !== null || removing !== null}
                      className="btn btn-ghost"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                    >
                      <MonitorPlay size={12} />
                      {opening === repo.name ? "Opening…" : "Cursor"}
                    </button>
                  )}
                  <HoverTip
                    label={
                      removing === repo.name
                        ? "Removing…"
                        : removing !== null || opening !== null
                          ? "Another repo operation is in progress."
                          : "Delete local clone only"
                    }
                  >
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: "12px", padding: "3px 8px", color: "var(--danger)" }}
                      disabled={removing !== null || opening !== null}
                      onClick={() => removeRepo(repo.name)}
                    >
                      <Trash2 size={12} />
                      {removing === repo.name ? "Removing…" : "Remove"}
                    </button>
                  </HoverTip>
                </div>
              </div>
            </div>
          );
        })}

      </div>

      {!isLoading && !localError && filteredLocalRepos.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {normalizedLocalQuery
            ? `No local repos matching "${query}".`
            : scanDirDisplay
            ? `No repos found in ${scanDirDisplay}${scanDirDisplay.endsWith("/") ? "" : "/"}.`
            : "No repos found."}
        </p>
      )}
    </div>
  );
}

function queryParam(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
}

function OpenChamberCard() {
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/status/services")
      .then((r) => r.json())
      .then((data) => setRunning(data?.openchamber?.active ?? false))
      .catch(() => setRunning(false));
  }, []);

  return (
    <div
      className="card"
      style={{
        padding: "12px 16px",
        borderLeft: `3px solid ${running ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm mb-0.5 flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Monitor size={14} style={{ color: "var(--accent)" }} />
            OpenChamber
          </div>
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: running ? "var(--success)" : "var(--text-subtle)" }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: running ? "var(--success)" : "var(--text-subtle)" }}
            />
            {running ? "Running on :1336" : "Not running"}
          </span>
        </div>
        <Link
          href="/chamber"
          className="btn btn-ghost"
          style={{ fontSize: "12px", padding: "3px 8px" }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}
