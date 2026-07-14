"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { useLive } from "@/lib/use-fetch";
import { useToast } from "@/lib/use-toast";
import { FetchError } from "@/components/FetchError";
import { BootScreen, useBootGate } from "@/components/TodayBootScreen";
import { useLaunchClaudeDesktop } from "@/lib/launch-claude";
import { useConfirm, usePrompt } from "@/components/ConfirmDialog";
import {
  agentRepoDxAuditCommand,
  agentRepoUpstartCommand,
  agentRepoUpstartDebugCommand,
  agentRepoUpstartUpdateCommand,
  openTerminal,
  repoUpstartCommand,
} from "@/lib/terminal-launch";
import {
  EmptyReposCard,
  GithubRepoCard,
  LocalRepoCard,
  SearchCard,
  SectionHeader,
  StatCard,
} from "./cards";
import { LearnPanel } from "./LearnPanel";
import { EvolutionStrip } from "./EvolutionStrip";
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
  const [opening, setOpening] = useState<string | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [learningRepoName, setLearningRepoName] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("learn");
  });
  const learningRepoNameRef = useRef<string | null>(learningRepoName);
  const { data: apps } = useLive<{ gitkraken: boolean }>("/api/repos/apps", {
    refreshInterval: 0,
  });
  const [isDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });
  const toast = useToast();
  const launchClaudeDesktop = useLaunchClaudeDesktop();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const githubRepos = githubData?.repos ?? [];
  const normalizedLocalQuery = query.trim().toLowerCase();
  const filteredLocalRepos = repos.filter((repo) => {
    if (normalizedLocalQuery && !repo.name.toLowerCase().includes(normalizedLocalQuery)) return false;
    if (localFilter === "changed") return repo.dirtyCount > 0;
    if (localFilter === "unpushed") return (repo.unpushedCount ?? 0) > 0;
    return true;
  });
  const learningRepo = learningRepoName
    ? repos.find((repo) => repo.name === learningRepoName) ?? null
    : null;
  const changedRepos = repos.filter((repo) => repo.dirtyCount > 0).length;
  const unpushedRepos = repos.filter((repo) => (repo.unpushedCount ?? 0) > 0).length;

  useEffect(() => {
    learningRepoNameRef.current = learningRepoName;
  }, [learningRepoName]);

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

  function openInTerminal(repo: { name: string; path: string }) {
    openTerminal({ cwd: repo.path, label: repo.name });
  }

  function openLearn(repo: RepoInfo) {
    setLearningRepoName(repo.name);
  }

  async function openInGitKraken(name: string) {
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(name)}/open-gitkraken`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      console.error("open in gitkraken:", e);
      toast.error(`Couldn't open ${name} in GitKraken.`);
    }
  }

  async function openUpstart(repo: RepoInfo, debug = false, context?: string) {
    let trimmedContext = context?.trim();
    if (!debug && !repo.hasUpstart && context === undefined) {
      const entered = await prompt({
        title: "Create and run upstart",
        message: "Optional startup context for the agent. Leave blank to continue without it.",
        input: { placeholder: "Context..." },
        confirmLabel: "Run",
      });
      trimmedContext = entered?.trim() ?? "";
    }
    openTerminal({
      cwd: repo.path,
      label: `${debug ? "Debug upstart" : "Upstart"} · ${repo.name}`,
      command: debug
        ? await agentRepoUpstartDebugCommand(repo.name, trimmedContext)
        : repo.hasUpstart && trimmedContext
          ? await agentRepoUpstartUpdateCommand(repo.name, trimmedContext)
        : repo.hasUpstart
          ? repoUpstartCommand()
          : await agentRepoUpstartCommand(repo.name, trimmedContext),
    });
  }

  async function openDxAudit(repo: RepoInfo) {
    const context = await prompt({
      title: `DX audit · ${repo.name}`,
      message:
        "Optional live question for the audit (e.g. \"should we move to Expo Go?\"). Leave blank for a full sweep.",
      input: { placeholder: "Question/context..." },
      confirmLabel: "Run audit",
    });
    if (context === null) return;
    openTerminal({
      cwd: repo.path,
      label: `DX audit · ${repo.name}`,
      command: await agentRepoDxAuditCommand(repo.name, context.trim() || undefined),
    });
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
    const ok = await confirm({
      title: `Remove local repo "${name}"?`,
      message: "This will delete the local folder only.",
      confirmLabel: "Remove",
      variant: "danger",
    });
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

  const panelAwarePageStyle =
    learningRepo && isDesktop
      ? {
          maxWidth: "calc(100vw - 600px)",
          marginLeft: 0,
          marginRight: 0,
        }
      : undefined;

  return (
    <div className="page-wrapper" style={panelAwarePageStyle}>
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

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 mb-3">
        <StatCard
          label="Changed"
          value={changedRepos}
          tone={changedRepos ? "warning" : "muted"}
          icon={<AlertCircle size={13} />}
          active={localFilter === "changed"}
          onClick={() => setLocalFilter((current) => current === "changed" ? null : "changed")}
        />
        <StatCard
          label="Unpushed"
          value={unpushedRepos}
          tone={unpushedRepos ? "accent" : "muted"}
          icon={<ArrowUpFromLine size={13} />}
          active={localFilter === "unpushed"}
          onClick={() => setLocalFilter((current) => current === "unpushed" ? null : "unpushed")}
        />
      </div>

      {isLoading && !data && (
        <div className="space-y-2 mb-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: "var(--radius)" }} />
          ))}
        </div>
      )}

      <SearchCard query={query} onQueryChange={setQuery} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-2">
          <SectionHeader
            label="Local"
            count={`${filteredLocalRepos.length}/${repos.length}`}
            description={
              localFilter === "changed"
                ? "Showing repos with local changes."
                : localFilter === "unpushed"
                  ? "Showing repos with unpushed commits."
                  : "Repos already cloned next to this DevHub checkout."
            }
          />

          {filteredLocalRepos.map((repo) => (
            <LocalRepoCard
              key={repo.name}
              repo={repo}
              githubUrl={githubUrl(repo.remote)}
              apps={apps}
              isDesktop={isDesktop}
              opening={opening}
              removing={removing}
              onLearn={openLearn}
              onDxAudit={openDxAudit}
              onUpstart={openUpstart}
              onTerminal={openInTerminal}
              onGitKraken={openInGitKraken}
              onCursor={openInCursor}
              onClaudeDesktop={launchClaudeDesktop}
              onRemove={removeRepo}
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

        <aside className="space-y-2">
          <SectionHeader
            label="GitHub"
            count={githubSearchQuery ? (isGithubValidating && !githubData ? "..." : githubRepos.length) : "search"}
            description="Search accessible repos, then clone or open them."
          />

          {githubError && (
            <FetchError message={parseGithubFetchErrorMessage(githubError)} onRetry={() => mutateGithub()} />
          )}
          {githubSearchQuery && isGithubValidating && !githubData && (
            <EmptyReposCard>
              Searching GitHub repos...
            </EmptyReposCard>
          )}

          {githubSearchQuery && githubRepos.map((repo) => (
            <GithubRepoCard
              key={repo.fullName}
              repo={repo}
              isDesktop={isDesktop}
              opening={opening}
              cloning={cloning}
              onCursor={openInCursor}
              onClone={cloneRepo}
            />
          ))}
          {!githubSearchQuery && (
            <EmptyReposCard>
              Type in the search box to query GitHub. Local repos filter instantly.
            </EmptyReposCard>
          )}
          {githubSearchQuery && !isGithubValidating && !githubError && githubRepos.length === 0 && (
            <EmptyReposCard>
              No GitHub repos matching &quot;{githubSearchQuery}&quot;.
            </EmptyReposCard>
          )}
        </aside>
      </div>

      <LearnPanel
        key={learningRepo?.name ?? "closed"}
        repo={learningRepo}
        onClose={() => {
          setLearningRepoName(null);
          learningRepoNameRef.current = null;
        }}
      />
    </div>
  );
}

function queryParam(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
}
