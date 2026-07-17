"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { FetchError } from "@/components/FetchError";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";
import {
  EmptyReposCard,
  GithubRepoCard,
  LocalRepoCard,
  SearchCard,
  SectionHeader,
} from "./cards";
import { LearnPanel } from "./LearnPanel";
import { EvolutionStrip } from "./EvolutionStrip";
import { useReposActions } from "./useReposActions";
import type { GithubReposApiPayload, RepoInfo, ReposApiPayload } from "./types";

function parseGithubFetchErrorMessage(error: unknown): string {
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const learnParam = searchParams.get("learn");

  const {
    data,
    isLoading,
    error: localError,
    mutate: mutateLocal,
    isValidating: isLocalValidating,
  } = useLive<ReposApiPayload>("/api/repos");
  const boot = useBootGate(data !== undefined || !!localError);
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
  const [localFilter, setLocalFilter] = useState<"changed" | "unpushed" | null>(null);
  const learningRepoNameRef = useRef<string | null>(learnParam);
  const { data: apps } = useLive<{ gitkraken: boolean; revealLabel?: string }>("/api/repos/apps", {
    refreshInterval: 0,
  });
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });
  const actions = useReposActions({
    mutateLocal: () => mutateLocal(),
    mutateGithub: () => mutateGithub(),
  });
  const githubRepos = githubData?.repos ?? [];
  const normalizedLocalQuery = query.trim().toLowerCase();
  const filteredLocalRepos = repos.filter((repo) => {
    if (normalizedLocalQuery && !repo.name.toLowerCase().includes(normalizedLocalQuery)) return false;
    if (localFilter === "changed") return repo.dirtyCount > 0;
    if (localFilter === "unpushed") return (repo.unpushedCount ?? 0) > 0;
    return true;
  });
  const learningRepo = learnParam
    ? repos.find((repo) => repo.name === learnParam) ?? null
    : null;
  const changedRepos = repos.filter((repo) => repo.dirtyCount > 0).length;
  const unpushedRepos = repos.filter((repo) => (repo.unpushedCount ?? 0) > 0).length;
  const showGithubColumn = !!githubSearchQuery;

  useEffect(() => {
    learningRepoNameRef.current = learnParam;
  }, [learnParam]);

  useEffect(() => {
    return () => {
      const repoName = learningRepoNameRef.current;
      if (repoName) {
        window.dispatchEvent(new CustomEvent("devhub:repo-learn-hidden", { detail: { repoName } }));
      }
    };
  }, []);

  useEffect(() => {
    if (!learningRepo) return;
    window.dispatchEvent(new CustomEvent("devhub:repo-learn-opened"));
  }, [learningRepo]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedGithubQuery(query);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  function setLearnParam(name: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (name) params.set("learn", name);
    else params.delete("learn");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function openLearn(repo: RepoInfo) {
    setLearnParam(repo.name);
  }

  function closeLearn() {
    learningRepoNameRef.current = null;
    setLearnParam(null);
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <div className="page-header">
        <div>
          <div className="page-title">Repos</div>
          <div className="page-subtitle">Clone, open, run, and get up to speed without spelunking through every folder by hand.</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="badge badge-accent">{repos.length} local</span>
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

      <EvolutionStrip />

      {localError && (
        <div className="card card-body mb-3">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <AlertCircle size={14} style={{ color: "var(--danger)" }} aria-hidden />
            Couldn&apos;t load local repos.
            <button type="button" className="btn btn-ghost ml-auto" onClick={() => mutateLocal()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {isLoading && !data && (
        <div className="space-y-2 mb-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius)" }} />
          ))}
        </div>
      )}

      <SearchCard
        query={query}
        onQueryChange={setQuery}
        localFilter={localFilter}
        onLocalFilterChange={setLocalFilter}
        changedCount={changedRepos}
        unpushedCount={unpushedRepos}
      />

      <div className={showGithubColumn ? "grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]" : undefined}>
        <section className="space-y-2">
          <SectionHeader
            label="Local"
            count={`${filteredLocalRepos.length}/${repos.length}`}
            description={
              localFilter === "changed"
                ? "Showing repos with local changes."
                : localFilter === "unpushed"
                  ? "Showing repos with unpushed commits."
                  : showGithubColumn
                    ? "Repos already cloned next to this DevHub checkout."
                    : "Local clones. Type above to also search GitHub."
            }
          />

          {filteredLocalRepos.map((repo) => (
            <LocalRepoCard
              key={repo.name}
              repo={repo}
              githubUrl={githubUrl(repo.remote)}
              apps={apps}
              isDesktop={isDesktop}
              opening={actions.opening}
              removing={actions.removing}
              onLearn={openLearn}
              onDxAudit={actions.openDxAudit}
              onUpstart={actions.openUpstart}
              onTerminal={actions.openInTerminal}
              onRevealFolder={(name) => actions.openInFolder(name, apps?.revealLabel ?? "folder")}
              onGitKraken={actions.openInGitKraken}
              onCursor={actions.openInCursor}
              onClaudeDesktop={actions.launchClaudeDesktop}
              onRemove={actions.removeRepo}
              onRefreshLocal={() => mutateLocal()}
            />
          ))}

          {!isLoading && !localError && filteredLocalRepos.length === 0 && (
            <EmptyReposCard>
              {normalizedLocalQuery
                ? `No local repos matching "${query}".`
                : localFilter === "changed"
                ? "No local repos with changes."
                : localFilter === "unpushed"
                ? "No local repos with unpushed commits."
                : scanDirDisplay
                ? `No repos found in ${scanDirDisplay}${scanDirDisplay.endsWith("/") ? "" : "/"}.`
                : "No repos found."}
            </EmptyReposCard>
          )}
        </section>

        {showGithubColumn && (
          <aside className="space-y-2">
            <SectionHeader
              label="GitHub"
              count={isGithubValidating && !githubData ? "..." : githubRepos.length}
              description="Search accessible repos, then clone or open them."
            />

            {githubError && (
              <FetchError message={parseGithubFetchErrorMessage(githubError)} onRetry={() => mutateGithub()} />
            )}
            {isGithubValidating && !githubData && (
              <EmptyReposCard>
                Searching GitHub repos...
              </EmptyReposCard>
            )}

            {githubRepos.map((repo) => (
              <GithubRepoCard
                key={repo.fullName}
                repo={repo}
                isDesktop={isDesktop}
                opening={actions.opening}
                cloning={actions.cloning}
                onCursor={actions.openInCursor}
                onClone={actions.cloneRepo}
              />
            ))}
            {!isGithubValidating && !githubError && githubRepos.length === 0 && (
              <EmptyReposCard>
                No GitHub repos matching &quot;{githubSearchQuery}&quot;.
              </EmptyReposCard>
            )}
          </aside>
        )}
      </div>

      {learnParam && !learningRepo && !isLoading && data && (
        <EmptyReposCard>
          No local repo named &quot;{learnParam}&quot; to learn. Clone it first, or clear the learn query.
        </EmptyReposCard>
      )}

      <LearnPanel
        key={learningRepo?.name ?? "closed"}
        repo={learningRepo}
        onHide={() => {
          if (learningRepo) {
            window.dispatchEvent(
              new CustomEvent("devhub:repo-learn-hidden", { detail: { repoName: learningRepo.name } }),
            );
          }
          closeLearn();
        }}
        onClose={closeLearn}
      />
    </div>
  );
}

function queryParam(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
}
