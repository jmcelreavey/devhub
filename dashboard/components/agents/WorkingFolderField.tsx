"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubRepoInfo, RepoInfo, ReposApiPayload } from "@/app/repos/types";
import { selectListedRepo } from "@/lib/tasks/implement-repo";

const GITHUB_FULL_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface WorkingFolderChoice {
  name: string;
  path: string;
}

export function WorkingFolderField({
  cwd,
  repoName,
  onChange,
}: {
  cwd: string;
  repoName?: string;
  onChange: (next: WorkingFolderChoice) => void;
}) {
  const [repos, setRepos] = useState<Pick<RepoInfo, "name" | "path">[]>([]);
  const [scanDirDisplay, setScanDirDisplay] = useState("~/Developer");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [dismissedMissingPrompt, setDismissedMissingPrompt] = useState(false);
  const [query, setQuery] = useState(repoName || "");
  const [hits, setHits] = useState<GithubRepoInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [cloning, setCloning] = useState("");
  const [cloneError, setCloneError] = useState("");
  const picked = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/repos")
      .then(async (response) => {
        const data = (await response.json()) as ReposApiPayload & { error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load repositories.");
        if (disposed) return;
        setRepos(data.repos ?? []);
        if (data.scanDirDisplay) setScanDirDisplay(data.scanDirDisplay);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setLoadError(err instanceof Error ? err.message : "Couldn't load repositories.");
        setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const match = useMemo(() => selectListedRepo(repos, { cwd, repoName }), [repos, cwd, repoName]);
  const missingAssigned = Boolean(repoName && loaded && !selectListedRepo(repos, { repoName }));
  const panelOpen = cloneOpen || (missingAssigned && !dismissedMissingPrompt);
  const activeQuery = panelOpen ? query.trim() : "";

  useEffect(() => {
    if (picked.current || !loaded || !match || match.path === cwd) return;
    onChangeRef.current(match);
  }, [loaded, match, cwd]);

  useEffect(() => {
    if (!activeQuery) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed) return;
      setSearching(true);
      void fetch(`/api/repos/github?q=${encodeURIComponent(activeQuery)}`)
        .then(async (response) => {
          const data = (await response.json()) as { repos?: GithubRepoInfo[]; error?: string };
          if (!response.ok) throw new Error(data.error || "Couldn't search GitHub.");
          if (!disposed) setHits(data.repos ?? []);
        })
        .catch((err: unknown) => {
          if (!disposed) setCloneError(err instanceof Error ? err.message : "Couldn't search GitHub.");
        })
        .finally(() => {
          if (!disposed) setSearching(false);
        });
    }, 300);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [activeQuery]);

  const displayHits = activeQuery ? hits : null;
  const displaySearching = Boolean(activeQuery && searching);

  const options = useMemo(() => {
    if (cwd && !repos.some((repo) => repo.path === cwd)) {
      return [{ name: repoName || cwd, path: cwd }, ...repos];
    }
    return repos;
  }, [cwd, repoName, repos]);

  const pick = (next: WorkingFolderChoice) => {
    picked.current = true;
    onChange(next);
  };

  const clone = async (fullName: string) => {
    setCloning(fullName);
    setCloneError("");
    try {
      const response = await fetch("/api/repos/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        repo?: { name: string; path: string };
      };
      if (!response.ok || !data.repo) throw new Error(data.error || `Couldn't clone ${fullName}.`);
      setRepos((list) => (list.some((repo) => repo.path === data.repo!.path) ? list : [...list, data.repo!]));
      pick(data.repo);
      setCloneOpen(false);
      setDismissedMissingPrompt(true);
    } catch (err: unknown) {
      setCloneError(err instanceof Error ? err.message : `Couldn't clone ${fullName}.`);
    } finally {
      setCloning("");
    }
  };

  const trimmedQuery = query.trim();
  const canCloneQuery = GITHUB_FULL_NAME.test(trimmedQuery);
  const queryAlreadyListed = displayHits?.some(
    (repo) => repo.fullName.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  return (
    <div className="block text-sm">
      <label className="block">
        Working folder
        <select
          className="input mt-1 w-full"
          value={cwd}
          required
          disabled={!loaded && !cwd}
          onChange={(event) => {
            const path = event.target.value;
            const repo = options.find((row) => row.path === path);
            if (repo) pick(repo);
          }}
        >
          <option value="">{loaded ? "Select a repository…" : "Loading repositories…"}</option>
          {options.map((repo) => (
            <option key={repo.path} value={repo.path}>
              {repo.name}
            </option>
          ))}
        </select>
      </label>
      {cwd ? <p className="mt-1 text-xs text-text-subtle">{cwd}</p> : null}
      {missingAssigned ? (
        <p className="mt-1 text-xs text-text-muted">
          Linked repo “{repoName}” isn’t in {scanDirDisplay}. Clone it or pick another folder.
        </p>
      ) : (
        <p className="mt-1 text-xs text-text-subtle">Local checkouts in {scanDirDisplay}.</p>
      )}
      {loadError ? <p className="mt-1 text-xs text-text-muted">{loadError}</p> : null}
      <button
        type="button"
        className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
        aria-expanded={panelOpen}
        onClick={() => {
          if (panelOpen) {
            setCloneOpen(false);
            setDismissedMissingPrompt(true);
          } else {
            setCloneOpen(true);
            setDismissedMissingPrompt(false);
            if (!query && repoName) setQuery(repoName);
          }
        }}
      >
        {panelOpen ? "Hide GitHub clone" : "Clone from GitHub"}
      </button>
      {panelOpen ? (
        <div className="mt-2 space-y-2">
          <label className="block text-xs text-text-muted">
            GitHub repo
            <input
              className="input mt-1 w-full"
              value={query}
              placeholder="owner/repo or search"
              onChange={(event) => {
                setQuery(event.target.value);
                setCloneError("");
              }}
            />
          </label>
          {displaySearching ? <p className="text-xs text-text-subtle">Searching…</p> : null}
          {displayHits && displayHits.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-auto">
              {displayHits.map((repo) => (
                <li key={repo.fullName} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {repo.fullName}
                    {repo.localRepoName ? (
                      <span className="text-text-subtle"> · local {repo.localRepoName}</span>
                    ) : null}
                  </span>
                  {repo.localRepoName ? (
                    <button
                      type="button"
                      className="shrink-0 text-accent underline-offset-2 hover:underline"
                      onClick={() => {
                        const local = repos.find((row) => row.name === repo.localRepoName);
                        if (local) pick(local);
                      }}
                    >
                      Use
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 text-accent underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={Boolean(cloning)}
                      onClick={() => void clone(repo.fullName)}
                    >
                      {cloning === repo.fullName ? "Cloning…" : "Clone"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {displayHits && displayHits.length === 0 && !displaySearching ? (
            <p className="text-xs text-text-muted">No GitHub repos matched. Paste owner/repo to clone.</p>
          ) : null}
          {canCloneQuery && !queryAlreadyListed ? (
            <button
              type="button"
              className="text-xs text-accent underline-offset-2 hover:underline disabled:opacity-50"
              disabled={Boolean(cloning)}
              onClick={() => void clone(trimmedQuery)}
            >
              {cloning === trimmedQuery ? "Cloning…" : `Clone ${trimmedQuery}`}
            </button>
          ) : null}
          {cloneError ? <p className="text-xs text-text-muted">{cloneError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
