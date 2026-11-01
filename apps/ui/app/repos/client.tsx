"use client";

import ConventionsClient from "@/app/conventions/client";
import OwnIndex from "@/components/repos/OwnIndex";
import RadarClient from "@/app/radar/client";
import { usePrompt } from "@/components/shell/ConfirmDialog";
import { BootScreen,useBootGate } from "@/components/ui/BootScreen";
import { FetchError } from "@/components/ui/FetchError";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { revalidateRepoOpenPrs } from "@/lib/github/repo-open-pr-swr";
import { useLive } from "@/lib/hooks/use-fetch";
import { useMinuteTick } from "@/lib/tickers";
import { useToast } from "@/lib/hooks/use-toast";
import { revalidateOwnedRepos } from "@/lib/ownership/owned-repos-swr";
import type { OwnedReposResponse } from "@shared/repos/ownership-types";
import { OWNED_REPOS_SWR_KEY } from "@/lib/ownership/owned-repos-swr";
import type { ConventionsSummary } from "../../../../packages/shared/ui-lib/conventions/types";
import { escapeRegExp } from "../../../../packages/shared/ui-lib/entity-note";
import type { RepoProject } from "../../../core/src/lib/projects";
import { repoTaskWork } from "@/lib/repos/repo-task-work";
import { useProfileWork } from "@/lib/storyboard/use-profile-work";
import type { Task } from "@shared/tasks/types";
import { AlertCircle,Folder,Plus,RefreshCw } from "lucide-react";
import Link from "@/lib/navigation";
import { useHistory,usePathname,useRouter,useSearchParams } from "@/lib/navigation";
import { useEffect,useMemo,useRef,useState } from "react";
import {
EmptyReposCard,
GithubRepoCard,
LocalRepoCard,
SearchCard,
SectionHeader,
} from "./cards";
import { EvolutionStrip } from "./EvolutionStrip";
import { RepoLearning } from "./LearnContent";
import { LearnPanel } from "./LearnPanel";
import type {
GithubReposApiPayload,
LocalRepoFilter,
RepoInfo,
ReposApiPayload,
RepoTaskPreview,
} from "@shared/repos/types";
import { useReposActions } from "./useReposActions";

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

function githubFullName(remote: string | null): string | null {
  return githubUrl(remote)?.replace("https://github.com/", "") ?? null;
}

/**
 * One-line card preview. Leftover hashtags are stripped, and the Jira key
 * gets its own chip — left in, it read "ABC-4897 ABC-4897 Ensure…".
 */
function asTaskPreview(task: Task): RepoTaskPreview {
  const key = task.jiraKey?.trim();
  let text = task.text.replace(/(^|\s)#[\w./-]+/g, " ");
  if (key) text = text.replace(new RegExp(`\\b${escapeRegExp(key)}\\b[\\s:–—-]*`, "gi"), " ");
  text = text.replace(/\s+/g, " ").trim();
  return { id: task.id, text: text || task.text, jiraKey: key };
}

const EMPTY_REPOS: RepoInfo[] = [];
const NO_TASKS: RepoTaskPreview[] = [];

const repoSections = [
  { id: "repos", label: "Repos", href: "/repos" },
  { id: "owned", label: "Owned", href: "/repos?view=owned" },
  { id: "learn", label: "Learning", href: "/repos?view=learn" },
  { id: "radar", label: "Radar", href: "/repos?view=radar" },
  { id: "conventions", label: "Conventions", href: "/repos?view=conventions" },
] as const;

type RepoSection = (typeof repoSections)[number]["id"];

function RepoSections({ active }: { active: RepoSection }) {
  const searchParams = useSearchParams();

  function hrefFor(section: (typeof repoSections)[number]): string {
    if ((active !== "repos" && active !== "owned") || (section.id !== "repos" && section.id !== "owned")) {
      return section.href;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (section.id === "owned") params.set("view", "owned");
    else params.delete("view");
    const query = params.toString();
    return query ? `/repos?${query}` : "/repos";
  }

  return (
    <nav aria-label="Repos views" className="mb-4">
      <div className="hub-tabs max-w-full flex-wrap">
        {repoSections.map((section) => (
          <Link
            key={section.id}
            href={hrefFor(section)}
            className="hub-tab whitespace-nowrap"
            data-active={section.id === active ? "true" : undefined}
            aria-current={section.id === active ? "page" : undefined}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export default function ReposPage() {
  const view = useSearchParams().get("view");
  if (view !== "owned" && view !== "learn" && view !== "radar" && view !== "conventions") {
    return <RepositoryList />;
  }

  return (
    <div className="page-wrapper">
      <header className="page-header">
        <div>
          <h1 className="page-title">Repos</h1>
          <div className="page-subtitle">Your repos, active work and local checkouts.</div>
        </div>
      </header>
      <RepoSections active={view} />
      {view === "owned" ? <OwnIndex embedded /> : null}
      {view === "learn" ? <RepoLearning /> : null}
      {view === "radar" ? <RadarClient embedded /> : null}
      {view === "conventions" ? <ConventionsClient embedded /> : null}
    </div>
  );
}

function RepositoryList() {
  const toast = useToast();
  const prompt = usePrompt();
  const router = useRouter();
  const history = useHistory();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const learnParam = searchParams.get("learn");
  const repoParam = searchParams.get("repo");
  const filterParam = searchParams.get("filter");
  const source = searchParams.get("source") === "github" ? "github" : "local";

  const {
    data,
    isLoading,
    error: localError,
    mutate: mutateLocal,
  } = useLive<ReposApiPayload>("/api/repos");
  const [refreshing, setRefreshing] = useState(false);
  const boot = useBootGate(data !== undefined || !!localError);
  const repos = data?.repos ?? EMPTY_REPOS;
  const { profile, board, inbox } = useProfileWork();
  const now = useMinuteTick();
  const tasksByRepo = useMemo(() => {
    const byRepo = new Map<string, RepoTaskPreview[]>();
    if (profile.error || !board.data || !inbox.data) return byRepo;
    for (const repo of repos) {
      const fullName = githubFullName(repo.remote);
      const work = repoTaskWork(board.data.cards, inbox.data.items, repo.name, fullName, now || Date.parse(board.data.generatedAt));
      const linked = [...work.active, ...work.backlog];
      if (linked.length > 0) byRepo.set(repo.name, linked.map(({ card, presentation }) => ({
        ...(card.task ? asTaskPreview(card.task) : { id: card.taskId, text: card.title }),
        status: board.error || inbox.error ? "Status unavailable" : presentation.status,
        needsYou: !board.error && !inbox.error && presentation.needsYou,
      })));
    }
    return byRepo;
  }, [repos, profile.error, board.data, board.error, inbox.data, inbox.error, now]);
  const { data: ownershipData, mutate: mutateOwnership } = useLive<OwnedReposResponse>(OWNED_REPOS_SWR_KEY);
  const [ownershipBusy, setOwnershipBusy] = useState<string | null>(null);
  const ownedRepos = useMemo(
    () => new Set((ownershipData?.repos ?? []).map((repo) => repo.fullName.toLowerCase())),
    [ownershipData?.repos],
  );
  // Active conventions are ready for agents without a review queue.
  const { data: conventionsData } = useLive<{ repos: ConventionsSummary[] }>("/api/conventions", { refreshInterval: 0 });
  const conventionsActive = useMemo(
    () => new Map((conventionsData?.repos ?? []).map((summary) => [summary.repo.toLowerCase(), summary.active])),
    [conventionsData?.repos],
  );
  const [query, setQuery] = useState(repoParam ?? "");
  const [debouncedGithubQuery, setDebouncedGithubQuery] = useState("");
  const { data: projectsData, mutate: mutateProjects } = useLive<{ projects: RepoProject[] }>("/api/projects", {
    refreshInterval: 0,
  });
  const projects = projectsData?.projects ?? [];
  const activeProjectId = searchParams.get("project");
  const githubSearchQuery = debouncedGithubQuery.trim();
  const githubKey = useMemo(
    () => (source === "github" && githubSearchQuery ? `/api/repos/github${queryParam(githubSearchQuery)}` : null),
    [source, githubSearchQuery],
  );
  const {
    data: githubData,
    error: githubError,
    mutate: mutateGithub,
  } = useLive<GithubReposApiPayload>(githubKey, { /* GitHub repositories change independently. */ refreshInterval: 120_000 });
  const scanDirDisplay = data?.scanDirDisplay ?? "";
  const [localFilter, setLocalFilter] = useState<LocalRepoFilter>(
    filterParam === "changed" || filterParam === "unpushed" || filterParam === "worktree" ? filterParam : null,
  );
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
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const projectRepos = useMemo(
    () => (activeProject ? new Set(activeProject.repos.map((r) => r.toLowerCase())) : null),
    [activeProject],
  );
  const normalizedLocalQuery = query.trim().toLowerCase();
  const matchingLocalRepos = repos.filter((repo) =>
    (!projectRepos || projectRepos.has(repo.name.toLowerCase())) &&
    (!normalizedLocalQuery || repo.name.toLowerCase().includes(normalizedLocalQuery)),
  );
  const filteredLocalRepos = matchingLocalRepos
    .filter((repo) => {
      if (localFilter === "changed") return repo.dirtyCount > 0;
      if (localFilter === "unpushed") return (repo.unpushedCount ?? 0) > 0;
      if (localFilter === "worktree") return Boolean(repo.worktreeOf) || (repo.worktreeCount ?? 0) > 0;
      return true;
    })
    // Repos you have open tasks for lead; the stable sort keeps recency order
    // within each half.
    .sort((a, b) => Number(tasksByRepo.has(b.name)) - Number(tasksByRepo.has(a.name)));
  const learningRepo = learnParam
    ? repos.find((repo) => repo.name === learnParam) ?? null
    : null;
  const changedRepos = matchingLocalRepos.filter((repo) => repo.dirtyCount > 0).length;
  const unpushedRepos = matchingLocalRepos.filter((repo) => (repo.unpushedCount ?? 0) > 0).length;
  const worktreesByRoot = new Map<string, number>();
  for (const repo of matchingLocalRepos) {
    const root = repo.worktreeOf || repo.path;
    worktreesByRoot.set(root, Math.max(worktreesByRoot.get(root) ?? 0, repo.worktreeCount ?? 0));
  }
  const worktreeRepos = [...worktreesByRoot.values()].reduce((total, count) => total + count, 0);
  const githubPending = query.trim() !== githubSearchQuery || (!githubData && !githubError);
  const hasLocalFilters = Boolean(query.trim() || localFilter || activeProjectId);

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
    const params = new URLSearchParams(window.location.search);
    if (name) params.set("learn", name);
    else params.delete("learn");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function openLearn(repo: RepoInfo) {
    router.push(`/repos?view=learn&repo=${encodeURIComponent(repo.name)}`);
  }

  function closeLearn() {
    learningRepoNameRef.current = null;
    setLearnParam(null);
  }

  async function toggleOwned(fullName: string, owned: boolean) {
    setOwnershipBusy(fullName);
    try {
      const response = await fetch("/api/own", {
        method: owned ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update ownership");
      revalidateOwnedRepos();
      await mutateOwnership();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update ownership");
    } finally {
      setOwnershipBusy(null);
    }
  }


  function replaceListParam(name: string, value: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(name, value);
    else params.delete(name);
    const query = params.toString();
    history.replace((query ? `${pathname}?${query}` : pathname) + window.location.hash, null);
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    replaceListParam("repo", nextQuery);
  }

  function changeLocalFilter(nextFilter: LocalRepoFilter) {
    setLocalFilter(nextFilter);
    replaceListParam("filter", nextFilter);
  }

  function setSource(next: "local" | "github") {
    const params = new URLSearchParams(window.location.search);
    if (next === "github") params.set("source", next);
    else params.delete("source");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function clearLocalFilters() {
    setQuery("");
    setLocalFilter(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("repo");
    params.delete("filter");
    params.delete("project");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setRepoView(next: { project?: string | null }) {
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    params.delete("project");
    if (next.project) params.set("project", next.project);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function createRepoGroup() {
    const label = await prompt({
      title: "New repo group",
      message: "Name this tab (e.g. Acme or Demo-App).",
      input: { placeholder: "Acme" },
      confirmLabel: "Next",
    });
    if (!label?.trim()) return;
    const reposRaw = await prompt({
      title: "Repos in this group",
      message: "Comma-separated local repo names.",
      input: { placeholder: "acme-api, demo-app" },
      confirmLabel: "Create",
    });
    if (reposRaw === null) return;
    const groupRepos = reposRaw.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim(), repos: groupRepos }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; projects?: RepoProject[] };
      if (!res.ok) throw new Error(body.error ?? "Could not create group");
      await mutateProjects();
      const created = (body.projects ?? []).find((g) => g.label === label.trim());
      if (created) setRepoView({ project: created.id });
      toast.success(`Created ${label.trim()}`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not create group");
    }
  }

  return (
    <div className="page-wrapper">
      <BootScreen state={boot} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Repos</h1>
          <div className="page-subtitle">Your repos, active work and local checkouts.</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="badge badge-accent" aria-label={data ? `${repos.length} local repositories` : "Local repository count not loaded"}>{data ? repos.length : "—"} local</span>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => {
              setRefreshing(true);
              void Promise.all([mutateLocal(), mutateGithub()])
                .catch(() => toast.error("Couldn’t refresh repositories."))
                .finally(() => setRefreshing(false));
              revalidateRepoOpenPrs();
            }}
            disabled={refreshing}
            aria-label="Refresh repos"
            title="Refresh repos"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} aria-hidden />
          </button>
        </div>
      </div>

      <RepoSections active="repos" />
      <EvolutionStrip />

      {source === "local" && (profile.error || board.error || inbox.error) ? (
        <FetchError bare message="Task status unavailable. Repo files and Git are still available." onRetry={() => { void profile.mutate(); void board.mutate(); void inbox.mutate(); }} />
      ) : null}

      {source === "local" && localError && (
        <div className="card card-body mb-3">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <AlertCircle size={14} className="text-danger" aria-hidden />
            Couldn&apos;t load local repos.
            <button type="button" className="btn btn-ghost ml-auto" onClick={() => mutateLocal()}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ToggleGroup
          aria-label="Repository source"
          options={[{ value: "local", label: "Local" }, { value: "github", label: "GitHub" }]}
          value={source}
          onChange={setSource}
          size="md"
        />
        <span className="text-xs text-text-muted">
          {source === "local" ? "Your local checkouts" : "Find repositories to clone or open"}
        </span>
      </div>

      {source === "local" && (
      <div className="hub-tabs mb-3" role="group" aria-label="Filter by repo group">
        <button
          type="button"
          className="hub-tab"
          aria-pressed={!activeProjectId}
          data-active={!activeProjectId ? "true" : undefined}
          onClick={() => setRepoView({})}
        >
          All
        </button>
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className="hub-tab"
            aria-label={`${project.label} group`}
            aria-pressed={activeProjectId === project.id}
            data-active={activeProjectId === project.id ? "true" : undefined}
            data-repo-group={project.id}
            onClick={() => setRepoView({ project: project.id })}
          >
            <Folder size={12} aria-hidden />
            {project.label}
          </button>
        ))}
        <button type="button" className="hub-tab" onClick={() => void createRepoGroup()}>
          <Plus size={12} aria-hidden /> New group
        </button>
      </div>
      )}

      <SearchCard
        query={query}
        onQueryChange={changeQuery}
        localFilter={localFilter}
        onLocalFilterChange={changeLocalFilter}
        changedCount={data ? changedRepos : null}
        unpushedCount={data ? unpushedRepos : null}
        worktreeCount={data ? worktreeRepos : null}
        source={source}
        activeProjectLabel={activeProject?.label}
        hasFilters={source === "local" ? hasLocalFilters : Boolean(query.trim())}
        onClearFilters={source === "local" ? clearLocalFilters : () => changeQuery("")}
      />

      <div>
        {source === "local" && (
        <section className="space-y-2" aria-label="Local repositories">
          <SectionHeader
            label="Local"
            count={!data ? "—" : hasLocalFilters ? `${filteredLocalRepos.length} of ${repos.length}` : repos.length}
            description={
              localFilter === "changed"
                ? "Showing repos with local changes."
                : localFilter === "unpushed"
                  ? "Showing repos with unpushed commits."
                  : localFilter === "worktree"
                    ? "Showing repositories with worktrees, including checkouts outside this folder."
                    : activeProject
                      ? `Local checkouts in ${activeProject.label}.`
                      : "Open a repo to see its work, changes, and tools."
            }
            actions={
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={actions.cloning !== null}
                  onClick={() => void actions.cloneFromUrl()}
                >
                  Clone URL
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={actions.cloning !== null}
                  onClick={() => void actions.initRepo()}
                >
                  New repo
                </button>
              </>
            }
          />

          {/* Shaped like the cards it becomes, and in their place — it used to
              sit above the tabs and shove the whole page down on arrival. */}
          {isLoading && !data ? (
            <div className="repos-grid" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="skeleton" style={{ height: 92, borderRadius: "var(--radius)" }} />
              ))}
            </div>
          ) : null}

          <div className="repos-grid">
          {filteredLocalRepos.map((repo) => (
            <LocalRepoCard
              key={repo.name}
              openTasks={tasksByRepo.get(repo.name) ?? NO_TASKS}
              repo={repo}
              githubUrl={githubUrl(repo.remote)}
              ownershipFullName={githubFullName(repo.remote)}
              owned={ownedRepos.has(githubFullName(repo.remote)?.toLowerCase() ?? "")}
              conventionsActive={conventionsActive.get(githubFullName(repo.remote)?.toLowerCase() ?? "") ?? 0}
              ownershipBusy={ownershipBusy}
              onToggleOwned={toggleOwned}
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
              onRemove={actions.removeRepo}
              onRefreshLocal={() => {
                void mutateLocal();
                revalidateRepoOpenPrs(repo.name);
              }}
            />
          ))}
          </div>

          {!isLoading && !localError && filteredLocalRepos.length === 0 && (
            <EmptyReposCard>
              {normalizedLocalQuery
                ? `No local repos matching "${query}".`
                : localFilter === "changed"
                ? "No local repos with changes."
                : localFilter === "unpushed"
                ? "No local repos with unpushed commits."
                : localFilter === "worktree"
                ? "No registered worktrees found for these repositories."
                : activeProject
                ? `No local repos in ${activeProject.label}.`
                : scanDirDisplay
                ? `No repos found in ${scanDirDisplay}${scanDirDisplay.endsWith("/") ? "" : "/"}.`
                : "No repos found."}
            </EmptyReposCard>
          )}
        </section>
        )}

        {source === "github" && (
          <section className="space-y-2" aria-label="GitHub repositories">
            <SectionHeader
              label="GitHub"
              count={query.trim() && !githubPending ? githubRepos.length : "—"}
              description="Search accessible repos, then clone or open them."
            />

            {query.trim() && !githubPending && githubError && (
              <FetchError message={parseGithubFetchErrorMessage(githubError)} onRetry={() => mutateGithub()} />
            )}
            {!query.trim() && (
              <EmptyReposCard>Search GitHub by repository name or owner to find a repo to clone.</EmptyReposCard>
            )}
            {query.trim() && githubPending && (
              <div className="space-y-2" role="status" aria-label="Searching GitHub repositories">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="skeleton h-24 rounded-lg" aria-hidden />
                ))}
              </div>
            )}

            {query.trim() && !githubPending && !githubError && githubRepos.map((repo) => (
              <GithubRepoCard
                key={repo.fullName}
                repo={repo}
                isDesktop={isDesktop}
                opening={actions.opening}
                cloning={actions.cloning}
                onCursor={actions.openInCursor}
                onClone={actions.cloneRepo}
                owned={ownedRepos.has(repo.fullName.toLowerCase())}
                ownershipBusy={ownershipBusy}
                onToggleOwned={toggleOwned}
              />
            ))}
            {query.trim() && !githubPending && !githubError && githubRepos.length === 0 && (
              <EmptyReposCard>
                No GitHub repos matching &quot;{githubSearchQuery}&quot;.
              </EmptyReposCard>
            )}
          </section>
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
