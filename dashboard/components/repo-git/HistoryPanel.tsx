"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CornerDownLeft,
  Download,
  GitBranch,
  GitMerge,
  Layers,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ContextMenu, useContextMenu } from "@/components/shell/ContextMenu";
import { useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useStoredFraction } from "@/lib/hooks/use-stored-state";
import { useToast } from "@/lib/hooks/use-toast";
import type { GitHookFailurePayload } from "@/lib/git/hook-failure";
import type { StashConflictPayload } from "@/app/repos/types";
import type { DiffLine, GraphCommitRaw } from "@/lib/repos/git-parsers";
import type { BranchOpenPr } from "@/lib/github/branch-pr";
import { jiraBrowseUrl } from "@/lib/utils";
import { lookupByEmail } from "@/lib/people/identity";
import { layoutCommitGraph, type GraphLaneCommit } from "@/lib/repos/git-graph";
import { recordUndo } from "@/lib/git/undo-stack";
import { CommitAvatar } from "./CommitAvatar";
import { CommitContextChips } from "./CommitContextChips";
import { CommitGraph } from "./CommitGraph";
import { DiffMaximizeModal } from "./DiffMaximizeModal";
import { DiffToolbar, DIFF_CONTEXT_LINES, type DiffContextMode } from "./DiffToolbar";
import { GitDiffView } from "./GitDiffView";
import { RangeCompareButton, RangeCompareModal } from "./RangeCompareModal";
import { RebasePlanModal } from "./RebasePlanModal";
import { RepoFileOpenMenu } from "./RepoFileOpenMenu";
import { WhyExistsAction } from "./WhyExistsAction";
import { RepoSplit } from "./SplitResize";
import { shareGitShowPatch } from "./shareGitPatch";
import { buildCommitMenuGroups } from "./commitMenuGroups";
import { usePointerDrag } from "./usePointerDrag";
import { launchAgentJob } from "@/lib/agent-job";
import { agentLocalCommitReviewCommand } from "@/lib/terminal-launch";
import {
  fetchGitJson,
  postGitAction,
  repoApi,
  type BranchesPayload,
} from "./shared";

interface CommitShowPayload {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
  parents: string[];
  files: { path: string; status: string }[];
  path: string | null;
  lines: DiffLine[];
  empty: boolean;
  context?: number;
  isHead?: boolean;
  isAncestorOfHead?: boolean;
  aheadCount?: number;
  /** `%G?` verification status; "G" means a good signature. */
  gpg?: string;
}

interface BranchRelation {
  currentBranch: string;
  mainBranch: string | null;
  mainShort: string | null;
  aheadMain: number;
  behindMain: number;
  onMain: boolean;
  mergedIntoMain: boolean;
  /**
   * Upstream-relative counts, kept separate from the main-relative ones above.
   * Pull acts on the upstream tracking branch, so "behind main" and "can pull"
   * are different questions and conflating them would offer a no-op button.
   */
  upstream: string | null;
  behindUpstream: number;
  /** Commits on HEAD that the upstream doesn't have — what Push would send. */
  aheadUpstream: number;
}

/** Subset of `Person` the history view needs; the rest is for other surfaces. */
interface RepoPerson {
  key: string;
  displayName: string;
  emails: string[];
  githubLogin: string | null;
  avatarUrl: string | null;
}

interface PeoplePayload {
  people?: RepoPerson[];
  githubConfigured?: boolean;
}

interface LogPayload {
  commits: GraphLaneCommit[];
  hasMore?: boolean;
  /** Open frontier of the page — the tips the next page walks from. */
  nextTips?: string[];
  /** Offset cursor, used instead of the frontier when the walk is filtered. */
  nextOffset?: number | null;
  /** True when this result is a filtered view rather than the whole graph. */
  searching?: boolean;
  currentBranch?: string;
  mainBranch?: string | null;
  mainShort?: string | null;
  aheadMain?: number;
  behindMain?: number;
  onMain?: boolean;
  mergedIntoMain?: boolean;
  /** merge-base(HEAD, main) — where this branch came off. */
  forkBase?: { hash: string; shortHash: string } | null;
  /** Full hashes of local commits not on main yet (capped at 300). */
  aheadOfMain?: string[];
}

export function HistoryPanel({
  repoName,
  repoPath,
  onMutate,
  onConflict,
  onHookFailure,
  pushing = false,
  onPush,
  wip = null,
  onOpenWip,
  focusUnpushed = false,
  onFocusUnpushedConsumed,
  focusCommit = null,
  onFocusCommitConsumed,
}: {
  repoName: string;
  repoPath: string;
  onMutate: () => void;
  /** Shared with the other tabs so a sync conflict lands in the same place. */
  onConflict?: (c: StashConflictPayload) => Promise<void>;
  onHookFailure?: (f: GitHookFailurePayload) => void;
  /** Workspace-level push so History shows the same spinner as the header. */
  pushing?: boolean;
  onPush?: () => void;
  /** Working-tree counts for the pinned WIP row; null hides it. */
  wip?: { staged: number; unstaged: number } | null;
  /** Click on the WIP row — the workspace switches to the Changes tab. */
  onOpenWip?: () => void;
  focusUnpushed?: boolean;
  onFocusUnpushedConsumed?: () => void;
  /** Select this commit on arrival — used by Blame's "Open in History". */
  focusCommit?: string | null;
  onFocusCommitConsumed?: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const commitMenu = useContextMenu<GraphLaneCommit>();
  /** Menu shown after a commit is dropped on a branch chip / rail item. */
  const dropMenu = useContextMenu<{ commit: GraphLaneCommit; branch: string }>();
  const [commits, setCommits] = useState<GraphLaneCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextTips, setNextTips] = useState<string[]>([]);
  /** Offset cursor, used only for filtered walks where the frontier is meaningless. */
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  /** All branches, or just HEAD and the default remote tip. */
  const [scope, setScope] = useState<"all" | "current">("all");
  const historyGeneration = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  /** Set while an externally focused commit should survive filter recalculation. */
  const [pinnedHash, setPinnedHash] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  /** Person key, not a display name — one person may commit under several names. */
  const [authorKey, setAuthorKey] = useState("");
  /** What the box shows; `search` is the debounced value the walk actually uses. */
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [unpushedOnly, setUnpushedOnly] = useState(false);
  const [unpushedHashes, setUnpushedHashes] = useState<Set<string>>(() => new Set());
  /** Local commits not on main yet — the tinted band from fork point to HEAD. */
  const [aheadOfMain, setAheadOfMain] = useState<Set<string>>(() => new Set());
  /** merge-base(HEAD, main) — the row the band starts below. */
  const [forkBase, setForkBase] = useState<string | null>(null);
  /** Open PR for the current branch, with its CI rollup. Lazy, best-effort. */
  const [openPr, setOpenPr] = useState<BranchOpenPr | null>(null);
  const [relation, setRelation] = useState<BranchRelation | null>(null);
  const [people, setPeople] = useState<RepoPerson[]>([]);
  const [detail, setDetail] = useState<CommitShowPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [contextMode, setContextMode] = useState<DiffContextMode>("default");
  const [historyListFr, setHistoryListFr] = useStoredFraction("devhub:repo-git:history-list-fr", 0.46);
  const [filesFr, setFilesFr] = useStoredFraction("devhub:repo-git:history-files-fr", 0.34);
  const [diffMaximized, setDiffMaximized] = useState(false);
  const closeMaximized = useCallback(() => setDiffMaximized(false), []);
  const [comparing, setComparing] = useState(false);
  /** Interactive-rebase planner, anchored below this commit. */
  const [rebaseBase, setRebaseBase] = useState<GraphLaneCommit | null>(null);
  /** Rolled-up CI state for the selected commit; keyed per sha for the session. */
  const [ciState, setCiState] = useState<{ state: string; counts?: { passed: number; failed: number; pending: number } } | null>(null);
  const ciCache = useRef(new Map<string, { state: string; counts?: { passed: number; failed: number; pending: number } }>());
  /** `/` jumps into the search box, so it needs a handle. */
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stackHistory = useMediaQuery("(max-width: 900px)");
  const stackDetail = useMediaQuery("(max-width: 720px)");

  /**
   * The repo's whole contributor list, not the authors of the loaded page.
   *
   * Deriving it from `commits` meant the dropdown grew as you paged, so the set
   * of people you could filter by depended on how far you had scrolled.
   */
  const authorFilter = useMemo(
    () => people.find((p) => p.key === authorKey) ?? null,
    [people, authorKey],
  );

  /**
   * Query string for the log walk.
   *
   * Search and the author filter run on the server. They used to filter the
   * loaded page in the browser, which meant typing a ticket number found
   * nothing unless that commit happened to be in the last 80 — and said so by
   * showing an empty list, indistinguishable from "no such commit".
   */
  const logQuery = useCallback(
    (extra?: { offset?: number; tips?: string[] }) => {
      const params = new URLSearchParams({ limit: "80" });
      if (scope === "current") params.set("scope", "current");
      if (search.trim()) params.set("q", search.trim());
      for (const email of authorFilter?.emails ?? []) params.append("author", email);
      if (extra?.offset) params.set("offset", String(extra.offset));
      if (extra?.tips?.length) params.set("tips", extra.tips.join(","));
      return `/git/log?${params.toString()}`;
    },
    [scope, search, authorFilter],
  );

  const refresh = useCallback(async () => {
    const generation = ++historyGeneration.current;
    setLoading(true);
    setLoadingMore(false);
    try {
      const [logJson, branchJson] = await Promise.all([
        fetchGitJson<LogPayload>(repoApi(repoName, logQuery())),
        fetchGitJson<BranchesPayload>(repoApi(repoName, "/branches")).catch(() => null),
      ]);
      if (generation !== historyGeneration.current) return;
      setCommits(logJson.commits ?? []);
      setHasMore(Boolean(logJson.hasMore));
      setNextTips(logJson.nextTips ?? []);
      setNextOffset(logJson.nextOffset ?? null);
      setSearching(Boolean(logJson.searching));
      setSelected((prev) => prev ?? logJson.commits?.[0]?.hash ?? null);
      setAheadOfMain(new Set(logJson.aheadOfMain ?? []));
      setForkBase(logJson.forkBase?.hash ?? null);
      setRelation({
        currentBranch: logJson.currentBranch ?? branchJson?.currentBranch ?? "HEAD",
        mainBranch: logJson.mainBranch ?? branchJson?.mainBranch ?? null,
        mainShort:
          logJson.mainShort ??
          (branchJson?.mainBranch ? branchJson.mainBranch.replace(/^origin\//, "") : null),
        aheadMain: logJson.aheadMain ?? branchJson?.aheadMain ?? 0,
        behindMain: logJson.behindMain ?? branchJson?.behindMain ?? 0,
        onMain: logJson.onMain ?? false,
        mergedIntoMain: logJson.mergedIntoMain ?? false,
        upstream: branchJson?.upstream ?? null,
        behindUpstream: branchJson?.behind ?? 0,
        aheadUpstream: branchJson?.ahead ?? 0,
      });

      if (branchJson) {
        const next = new Set<string>();
        for (const c of branchJson.unpushedCommits ?? []) {
          if (c.hash) next.add(c.hash);
          if (c.shortHash) next.add(c.shortHash);
        }
        setUnpushedHashes(next);
      }
    } catch (err) {
      if (generation === historyGeneration.current) {
        toast.error(err instanceof Error ? err.message : "History failed");
      }
    } finally {
      if (generation === historyGeneration.current) setLoading(false);
    }
  }, [repoName, toast, logQuery]);

  useEffect(() => {
    // Deliberately not awaited with the log. This is one network call behind
    // `gh`, and the commit list must not wait on it — avatars arrive late and
    // swap in over the initials, which is the same thing that happens when
    // Gravatar is slow.
    //
    // Guarded by the effect's own lifetime rather than by historyGeneration.
    // This map is keyed on the repo and outlives any single refresh, and the
    // generation counter cannot express that: this effect runs before the one
    // that calls refresh(), so it captured the pre-increment value and threw
    // every result away.
    let live = true;
    void fetchGitJson<PeoplePayload>(repoApi(repoName, "/git/people"))
      .then((json) => {
        if (!live) return;
        setPeople(json.people ?? []);
      })
      .catch(() => {
        // No GitHub remote, no `gh`, or rate-limited. Gravatar and initials
        // still cover the column, so there is nothing worth telling the user.
      });
    return () => {
      live = false;
    };
  }, [repoName]);

  /**
   * email → the identity to draw for it. Built from people rather than raw
   * accounts so every address one person commits under resolves to the same
   * avatar and name — otherwise they render as two contributors on one screen.
   */
  const identityByEmail = useMemo(() => {
    const index: Record<string, { avatarUrl: string | null; displayName: string }> = {};
    for (const person of people) {
      const ident = { avatarUrl: person.avatarUrl, displayName: person.displayName };
      for (const email of person.emails) {
        const key = email.trim().toLowerCase();
        if (key) index[key] = ident;
      }
    }
    return index;
  }, [people]);

  const loadMore = useCallback(async () => {
    // Two cursor styles: the frontier continues a full-ancestry walk, the offset
    // continues a filtered one. Which is live depends on whether a filter is on.
    const cursor = searching
      ? nextOffset !== null
        ? { offset: nextOffset }
        : null
      : nextTips.length > 0
        ? { tips: nextTips }
        : null;
    if (loadingMore || !hasMore || !cursor) return;
    const generation = historyGeneration.current;
    setLoadingMore(true);
    try {
      const page = await fetchGitJson<LogPayload>(repoApi(repoName, logQuery(cursor)));
      if (generation !== historyGeneration.current) return;
      setCommits((current) => {
        const byHash = new Map<string, GraphCommitRaw>();
        for (const commit of [...current, ...(page.commits ?? [])]) {
          byHash.set(commit.hash, {
            hash: commit.hash,
            shortHash: commit.shortHash,
            parents: commit.parents,
            subject: commit.subject,
            author: commit.author,
            authorEmail: commit.authorEmail,
            relativeDate: commit.relativeDate,
            refs: commit.refs,
            isHead: commit.isHead,
            headBranch: commit.headBranch,
            ...(commit.gpg ? { gpg: commit.gpg } : {}),
          });
        }
        return layoutCommitGraph([...byHash.values()]);
      });
      setHasMore(Boolean(page.hasMore));
      setNextTips(page.nextTips ?? []);
      setNextOffset(page.nextOffset ?? null);
    } catch (err) {
      if (generation === historyGeneration.current) {
        toast.error(err instanceof Error ? err.message : "Could not load older commits");
      }
    } finally {
      if (generation === historyGeneration.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextTips, nextOffset, searching, repoName, toast, logQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch log on mount / repo change
    void refresh();
  }, [refresh]);

  /**
   * Debounce the text box before it reaches `refresh`.
   *
   * `search` now feeds a subprocess rather than an array filter, so firing on
   * every keystroke would queue a `git log --grep` per character. The author and
   * scope controls are discrete choices and go straight through.
   */
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    if (!focusUnpushed) return;
    setUnpushedOnly(true); // eslint-disable-line react-hooks/set-state-in-effect -- badge navigates into unpushed filter
    onFocusUnpushedConsumed?.();
  }, [focusUnpushed, onFocusUnpushedConsumed]);

  // Open PR for the current branch. Deliberately not awaited with the log —
  // same reasoning as the people fetch below: one gh call must never delay
  // the graph, and a missing/slow gh just means no chip.
  const currentBranch = relation?.currentBranch ?? null;
  // Clear the stale branch's PR during render (React adjust-state pattern) so
  // a branch switch never shows the previous branch's PR for a frame.
  const [seenPrBranch, setSeenPrBranch] = useState(currentBranch);
  if (currentBranch !== seenPrBranch) {
    setSeenPrBranch(currentBranch);
    setOpenPr(null);
  }
  useEffect(() => {
    let live = true;
    void fetchGitJson<{ pr: BranchOpenPr | null }>(repoApi(repoName, "/git/branch-pr"))
      .then((json) => {
        if (live) setOpenPr(json.pr ?? null);
      })
      .catch(() => {
        // No gh / no remote / rate-limited — the chip simply doesn't show.
      });
    return () => {
      live = false;
    };
  }, [repoName, currentBranch]);

  // CI state rides one gh call per selected commit, cached for the session —
  // paging back to a commit you already inspected costs nothing.
  useEffect(() => {
    if (!selected) return;
    const cached = ciCache.current.get(selected);
    setCiState(cached ?? null);
    if (cached) return;
    let cancelled = false;
    void fetchGitJson<{ state: string; counts?: { passed: number; failed: number; pending: number } }>(
      repoApi(repoName, `/git/ci?commit=${selected}`),
    )
      .then((json) => {
        if (cancelled || json.state === "none") return;
        ciCache.current.set(selected, json);
        setCiState(json);
      })
      .catch(() => {
        // No gh, no remote, rate-limited — the chip just doesn't show.
      });
    return () => {
      cancelled = true;
    };
  }, [selected, repoName]);

  // `/` focuses history search unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT") return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isUnpushed = useCallback(
    (c: GraphLaneCommit) => unpushedHashes.has(c.hash) || unpushedHashes.has(c.shortHash),
    [unpushedHashes],
  );

  /**
   * Only the unpushed filter remains client-side, and it belongs there: it is a
   * question about local state the server walk does not model. Message search
   * and author both moved to `git log`, so they cover the whole history rather
   * than whatever happens to be loaded.
   */
  const filtered = useMemo(
    () => (unpushedOnly ? commits.filter(isUnpushed) : commits),
    [commits, unpushedOnly, isUnpushed],
  );

  /**
   * Lay the graph out over exactly the rows that get drawn.
   *
   * The filtered list used to be handed to CommitGraph carrying lanes computed
   * over the *unfiltered* set, so with any filter active every parent resolved
   * to a row that was no longer rendered and each edge degraded to a stub — the
   * graph lost its lines precisely when you were searching through it.
   */
  const graphRows = useMemo(() => layoutCommitGraph(filtered), [filtered]);

  useEffect(() => {
    // A commit focused from Blame owns the selection: it is routinely older than
    // the log window we loaded, so the usual "snap to the first visible row"
    // correction below would bounce it straight back off screen.
    if (pinnedHash) return;
    if (filtered.length === 0) {
      setSelected(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear selection when filter empties
      return;
    }
    setSelected((prev) => (prev && filtered.some((c) => c.hash === prev) ? prev : filtered[0]!.hash));
  }, [filtered, pinnedHash]);

  useEffect(() => {
    if (!focusCommit) return;
    // Clear filters so the commit is visible if it *is* in the loaded log.
    setAuthorKey(""); // eslint-disable-line react-hooks/set-state-in-effect -- external navigation into a specific commit
    setSearchInput("");
    setSearch("");
    setUnpushedOnly(false);
    setSelectedFile(null);
    setSelected(focusCommit);
    setPinnedHash(focusCommit);
    onFocusCommitConsumed?.();
  }, [focusCommit, onFocusCommitConsumed]);

  useEffect(() => {
    if (!selected) {
      setDetail(null); // eslint-disable-line react-hooks/set-state-in-effect -- clear detail when nothing selected
      setSelectedFile(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const params = new URLSearchParams({ commit: selected });
        if (selectedFile) params.set("path", selectedFile);
        if (contextMode === "full") {
          params.set("full", "1");
        } else {
          params.set("context", String(DIFF_CONTEXT_LINES[contextMode]));
        }
        const json = await fetchGitJson<CommitShowPayload>(
          repoApi(repoName, `/git/show?${params.toString()}`),
        );
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) {
          setDetail(null);
          toast.error(err instanceof Error ? err.message : "Commit detail failed");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoName, selected, selectedFile, contextMode, toast]);

  /** POST a branches action with confirm + toasts (undo-commit / reset-stash-ahead). */
  async function confirmedBranchesAction(opts: {
    actingKey: string;
    confirmTitle: string;
    confirmMessage: string;
    confirmLabel: string;
    body: Record<string, unknown>;
    successToast: (json: Record<string, unknown>) => string;
    failLabel: string;
    onSuccess?: () => void;
  }) {
    const ok = await confirm({
      title: opts.confirmTitle,
      message: opts.confirmMessage,
      confirmLabel: opts.confirmLabel,
      variant: "danger",
    });
    if (!ok) return;
    setActing(opts.actingKey);
    try {
      const result = await postGitAction<Record<string, unknown>>(
        repoApi(repoName, "/branches"),
        opts.body,
      );
      if (!result.ok) throw new Error(result.kind === "error" ? result.message : result.kind);
      toast.success(opts.successToast(result.json));
      opts.onSuccess?.();
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : opts.failLabel);
    } finally {
      setActing(null);
    }
  }

  /**
   * Fetch / pull straight from the relation strip.
   *
   * Both actions already existed on the branches route — they were only
   * reachable from the Branches tab, so History could tell you it was behind
   * and then offer nothing to do about it.
   */
  async function incoming(action: "fetch" | "pull" | "pull-rebase" | "pull-merge") {
    if (action === "pull-rebase" || action === "pull-merge") {
      const ok = await confirm({
        title: action === "pull-rebase" ? "Pull with rebase?" : "Pull with merge?",
        message:
          action === "pull-rebase"
            ? "git pull --rebase. Replays your local commits on top of upstream. No merge commit. Conflicts open in the Conflicts tab."
            : "git pull --no-rebase. Merges upstream into this branch. Conflicts open in the Conflicts tab.",
        confirmLabel: action === "pull-rebase" ? "Rebase pull" : "Merge pull",
        variant: action === "pull-rebase" ? "danger" : undefined,
      });
      if (!ok) return;
    }
    setActing(action);
    try {
      const result = await postGitAction<{ alreadyUpToDate?: boolean; message?: string; headBefore?: string | null }>(
        repoApi(repoName, "/branches"),
        { action },
      );
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict?.(result.conflict);
          onMutate();
          await refresh();
          return;
        }
        if (result.kind === "hook") {
          onHookFailure?.(result.hook);
          return;
        }
        throw new Error(result.message);
      }
      if (action === "fetch") {
        toast.success("Fetched — remote refs updated");
      } else if (result.json.alreadyUpToDate) {
        toast.success(result.json.message || "Already up to date — nothing to pull.");
      } else if (action === "pull-rebase") {
        toast.success("Pulled with rebase");
      } else if (action === "pull-merge") {
        toast.success("Pulled with merge");
      } else {
        toast.success(result.json.message?.split("\n")[0] || "Pulled");
      }
      // A merge pull moved HEAD forward; the header chip can undo it.
      if (action === "pull-merge" && !result.json.alreadyUpToDate && result.json.headBefore) {
        recordUndo(repoName, {
          id: `pull-merge:${result.json.headBefore}`,
          label: "merge pull",
          headBefore: result.json.headBefore,
          kind: "hard",
        });
      }
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setActing(null);
    }
  }

  /**
   * Sync with main, from History.
   *
   * It already lived on the Branches tab, which meant the screen that tells you
   * you're behind main was not the screen that could do anything about it.
   */
  async function syncWithMain() {
    const target = relation?.mainBranch ?? "main";
    const ok = await confirm({
      title: `Sync with ${target}?`,
      message: `Stashes any local work, fetches ${target}, merges it into ${
        relation?.currentBranch ?? "this branch"
      }, pushes, then restores the stash. Conflicts open in the Conflicts tab.`,
      confirmLabel: "Sync",
    });
    if (!ok) return;
    setActing("sync-main");
    try {
      const result = await postGitAction<{ message?: string }>(repoApi(repoName, "/branches"), {
        action: "sync-main",
      });
      if (!result.ok) {
        if (result.kind === "conflict") {
          await onConflict?.(result.conflict);
          onMutate();
          await refresh();
          return;
        }
        if (result.kind === "hook") {
          onHookFailure?.(result.hook);
          return;
        }
        throw new Error(result.message);
      }
      toast.success(`Synced with ${target}`);
      onMutate();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setActing(null);
    }
  }

  async function undo() {
    await confirmedBranchesAction({
      actingKey: "undo",
      confirmTitle: "Undo last commit?",
      confirmMessage:
        "Soft reset (git reset --soft HEAD~1). Changes stay staged. Does not touch the remote.",
      confirmLabel: "Undo",
      body: { action: "undo-commit" },
      successToast: () => "Undid last commit (soft)",
      failLabel: "Undo failed",
    });
  }

  async function resetStashAhead() {
    if (!detail || !selected || detail.hash !== selected) return;
    if (detail.isHead || !detail.isAncestorOfHead || !(detail.aheadCount && detail.aheadCount > 0)) {
      return;
    }
    const ahead = detail.aheadCount;
    const short = detail.shortHash;
    await confirmedBranchesAction({
      actingKey: "reset-stash",
      confirmTitle: "Stash ahead & reset?",
      confirmMessage: `${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${short} will be stashed, then this branch resets to that commit. Working tree must be clean. Does not touch the remote.`,
      confirmLabel: "Stash & reset",
      body: { action: "reset-stash-ahead", commit: detail.hash },
      successToast: (json) => {
        const j = json as {
          stashRef?: string | null;
          stashMessage?: string | null;
          shortHash?: string;
          aheadCount?: number;
          message?: string;
        };
        const stashBit = j.stashRef
          ? ` · ${j.stashRef}${j.stashMessage ? ` “${j.stashMessage}”` : ""}`
          : "";
        return (
          j.message ??
          `Reset to ${j.shortHash ?? short}; stashed ${j.aheadCount ?? ahead} commit${
            (j.aheadCount ?? ahead) === 1 ? "" : "s"
          }${stashBit}`
        );
      },
      failLabel: "Reset & stash failed",
      onSuccess: () => setSelectedFile(null),
    });
  }

  const runCommitAction = useCallback(
    async (action: string, commit: GraphLaneCommit, name?: string) => {
      setActing(action);
      try {
        const result = await postGitAction<{ backupBranch?: string | null; headBefore?: string | null }>(
          repoApi(repoName, "/git/commit-action"),
          { action, commit: commit.hash, name },
        );
        if (!result.ok) {
          if (result.kind === "conflict") {
            await onConflict?.(result.conflict);
            onMutate();
            await refresh();
            return;
          }
          throw new Error(result.kind === "error" ? result.message : result.kind);
        }
        const labels: Record<string, string> = {
          "cherry-pick": `Cherry-picked ${commit.shortHash}`,
          revert: `Reverted ${commit.shortHash}`,
          tag: `Created tag ${name}`,
          "checkout-detached": `Checked out ${commit.shortHash} (detached)`,
          "reset-to-commit": `Reset to ${commit.shortHash}`,
          "branch-from-commit": `Created branch ${name}`,
        };
        toast.success(labels[action] ?? "Done");
        if (result.json.backupBranch) {
          toast.info(`Backup branch: ${result.json.backupBranch}`, { duration: 9000 });
        }
        // cherry-pick/revert move HEAD forward; the header chip can undo them
        // with a hard reset to the recorded pre-action HEAD.
        if ((action === "cherry-pick" || action === "revert") && result.json.headBefore) {
          recordUndo(repoName, {
            id: `${action}:${commit.hash}`,
            label: `${action} ${commit.shortHash}`,
            headBefore: result.json.headBefore,
            kind: "hard",
          });
        }
        setSelectedFile(null);
        onMutate();
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Commit action failed");
      } finally {
        setActing(null);
      }
    },
    [onConflict, onMutate, refresh, repoName, toast],
  );

  const confirmCommitAction = useCallback(
    async (
      action: string,
      commit: GraphLaneCommit,
      title: string,
      message: string,
      confirmLabel: string,
    ) => {
      const ok = await confirm({ title, message, confirmLabel, variant: "danger" });
      if (ok) await runCommitAction(action, commit);
    },
    [confirm, runCommitAction],
  );

  /** Switch branches (server auto-stashes), surfacing conflicts to the shared dialog. */
  async function checkoutBranch(branch: string): Promise<boolean> {
    const result = await postGitAction(repoApi(repoName, "/branches"), { action: "checkout", branch });
    if (!result.ok) {
      if (result.kind === "conflict") await onConflict?.(result.conflict);
      else toast.error(result.kind === "error" ? result.message : "Checkout failed");
      return false;
    }
    return true;
  }

  /** Drag a commit onto a branch chip → apply it relative to that branch. */
  const branchDrag = usePointerDrag<GraphLaneCommit>({
    dropSelector: "[data-drop-branch]",
    onDrop: (commit, target, at) => {
      const branch = target.getAttribute("data-drop-branch");
      if (branch) dropMenu.openAtPoint(at.x, at.y, { commit, branch });
    },
  });

  const commitMenuGroups = useMemo(
    () =>
      // `runCommitAction` reaches `refresh`, which reads `historyGeneration.current`
      // for its stale-response guard, so the compiler treats both action callbacks as
      // ref-readers and cannot prove `buildCommitMenuGroups` does not call one during
      // render. It does not: it returns [] for a null commit and otherwise only wraps
      // them in `onSelect` closures that fire on click. Revisit if that builder ever
      // starts invoking a callback while constructing the menu.
      // eslint-disable-next-line react-hooks/refs
      buildCommitMenuGroups(commitMenu.target, {
        busy: acting !== null,
        confirmCommitAction,
        prompt,
        runCommitAction,
        onRebasePlan: (commit) => setRebaseBase(commit),
        onCopySha: (commit) =>
          void copyTextToClipboard(commit.hash).then(() => toast.success("SHA copied")),
        onCopyMessage: (commit) =>
          void copyTextToClipboard(commit.subject).then(() => toast.success("Commit message copied")),
        onSharePatch: (commit) =>
          void shareGitShowPatch(repoName, commit.hash).then(
            (msg) => toast.success(msg),
            (err: unknown) => toast.error(err instanceof Error ? err.message : "Share failed"),
          ),
        onReview: (commit) => {
          void (async () => {
            const date = new Date().toISOString().slice(0, 10);
            const notePath = `reviews/${repoName}-${date}`;
            // Hand the reviewer agent the same context chips the UI shows:
            // PRs, tickets and derived links, so it doesn't have to rediscover them.
            const context = await fetchGitJson<{
              tickets?: string[];
              prNumbers?: number[];
              prRepo?: string | null;
              related?: { kind: string; id: string }[];
            }>(repoApi(repoName, `/git/commit-context?commit=${encodeURIComponent(commit.hash)}`))
              .then((json) => {
                const bits: string[] = [];
                if (json.prRepo && json.prNumbers?.length) {
                  bits.push(`PRs: ${json.prNumbers.map((n) => `${json.prRepo}#${n}`).join(", ")}`);
                }
                if (json.tickets?.length) bits.push(`Tickets: ${json.tickets.join(", ")}`);
                const rel = (json.related ?? [])
                  .filter((r) => r.kind === "note" || r.kind === "tag")
                  .slice(0, 5);
                if (rel.length) bits.push(`Related: ${rel.map((r) => `${r.kind}:${r.id}`).join(", ")}`);
                return bits.length ? ` Known context — ${bits.join("; ")}.` : "";
              })
              .catch(() => "");
            const promptText = [
              `Use the pr-explain-review skill to explain and review local commit ${commit.hash} ("${commit.subject}") in the ${repoName} repo. This is not a GitHub PR — review the commit and its parent window in the local git history.`,
              context,
              `Write the report to DevHub notes via the notes MCP (notes_write). Notes MCP path: ${notePath}.`,
              `Include a Repo entity link for ${repoName} in the note's ## Links section.`,
              `Finish with a terminal summary, then exit.`,
            ]
              .filter(Boolean)
              .join(" ");
            const result = await launchAgentJob({
              title: `review · ${commit.shortHash}`,
              kind: "review",
              cwd: repoPath,
              repoName,
              notePath,
              promptText,
              promptCommand: await agentLocalCommitReviewCommand(
                repoName,
                commit.hash,
                commit.subject,
              ),
              mode: "oneshot",
              alreadyConfirmed: true,
              reason: `Review commit ${commit.shortHash}`,
            });
            toast.info(
              result.channel === "opencode"
                ? `Review running in OpenCode — note at ${notePath}.`
                : `Review queued in the Agent tab — note at ${notePath}.`,
            );
          })();
        },
      }),
    [acting, commitMenu.target, confirmCommitAction, prompt, repoName, repoPath, runCommitAction, toast],
  );

  const dropMenuGroups = useMemo(() => {
    const target = dropMenu.target;
    if (!target) return [];
    const { commit, branch } = target;
    return [
      {
        id: "drop-actions",
        label: `${commit.shortHash} → ${branch}`,
        items: [
          {
            id: "cherry-onto",
            label: `Cherry-pick onto ${branch}`,
            description: "Switches to that branch and applies the commit there",
            disabled: acting !== null,
            onSelect: () =>
              void (async () => {
                if (!(await checkoutBranch(branch))) return;
                await runCommitAction("cherry-pick", commit);
              })(),
          },
          {
            id: "merge-into",
            label: `Merge ${branch} into current`,
            description: "Merge that branch into the checked-out one",
            disabled: acting !== null,
            onSelect: () =>
              void confirmedBranchesAction({
                actingKey: "drop-merge",
                confirmTitle: `Merge ${branch}?`,
                confirmMessage: `Merges ${branch} into the current branch. Conflicts open in the Conflicts tab.`,
                confirmLabel: "Merge",
                body: { action: "merge-branch", branch },
                successToast: () => `Merged ${branch}`,
                failLabel: "Merge failed",
              }),
          },
          {
            id: "rebase-onto",
            label: `Rebase current onto ${branch}`,
            description: "Replays the current branch's commits on top of that branch",
            danger: true,
            disabled: acting !== null,
            onSelect: () =>
              void confirmedBranchesAction({
                actingKey: "drop-rebase",
                confirmTitle: `Rebase onto ${branch}?`,
                confirmMessage: `Rewrites the current branch onto ${branch}. Conflicts open in the Conflicts tab.`,
                confirmLabel: "Rebase",
                body: { action: "rebase-branch", branch },
                successToast: () => `Rebased onto ${branch}`,
                failLabel: "Rebase failed",
              }),
          },
        ],
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirmedBranchesAction is a stable-enough closure; menu rebuilds per open
  }, [dropMenu.target, acting]);

  if (loading && commits.length === 0) return <SkeletonRows count={8} height={32} />;

  const selectedCommit = commits.find((c) => c.hash === selected) ?? null;
  const hasFilters = Boolean(authorFilter || search.trim() || unpushedOnly);
  const detailForSelection = detail && selected && detail.hash === selected ? detail : null;
  const detailIdentity = detailForSelection
    ? lookupByEmail(identityByEmail, detailForSelection.authorEmail)
    : undefined;
  const activeFile = selectedFile ?? detailForSelection?.path ?? null;
  const canResetStashAhead =
    Boolean(detailForSelection) &&
    detailForSelection?.isHead !== true &&
    detailForSelection?.isAncestorOfHead === true &&
    (detailForSelection?.aheadCount ?? 0) > 0;
  const showDivergedNote =
    Boolean(detailForSelection) &&
    detailForSelection?.isHead !== true &&
    detailForSelection?.isAncestorOfHead === false;

  return (
    <div className="repo-git-history">
      <div className="repo-git-changes-toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} /> Refresh
        </button>
        <button type="button" className="btn btn-ghost" disabled={acting !== null} onClick={() => void undo()}>
          {acting === "undo" ? <RefreshCw size={11} className="animate-spin" /> : <RotateCcw size={11} />}
          Undo last commit
        </button>
        {relation && !relation.onMain ? (
          <RangeCompareButton onClick={() => setComparing(true)} />
        ) : null}
        {unpushedHashes.size > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            data-active={unpushedOnly || undefined}
            aria-pressed={unpushedOnly}
            onClick={() => setUnpushedOnly((v) => !v)}
            title={unpushedOnly ? "Show all commits" : "Show only unpushed commits"}
          >
            <Upload size={11} />
            {unpushedOnly ? "Unpushed only" : "Unpushed"}
          </button>
        )}
        <div className="repo-git-spacer" />
        {/*
          Scope toggle. The walk covers every ref by default, which is what makes
          side branches visible at all; a repo with hundreds of refs can want the
          narrow view back, and until now the only way to ask for it was to edit
          the query string by hand.
        */}
        <button
          type="button"
          className="btn btn-ghost"
          data-active={scope === "all" || undefined}
          aria-pressed={scope === "all"}
          onClick={() => setScope((s) => (s === "all" ? "current" : "all"))}
          title={
            scope === "all"
              ? "Showing every branch — click for this branch and main only"
              : "Showing this branch and main — click for every branch"
          }
        >
          <GitBranch size={11} />
          {scope === "all" ? "All branches" : "This branch"}
        </button>
        <label className="repo-git-filter">
          <span className="sr-only">Author</span>
          <select
            className="input repo-git-filter-select"
            value={authorKey}
            onChange={(e) => setAuthorKey(e.target.value)}
            aria-label="Filter by author"
          >
            <option value="">All authors</option>
            {people.map((p) => (
              <option key={p.key} value={p.key}>
                {p.displayName}
                {p.emails.length > 1 ? ` (${p.emails.length} addresses)` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="repo-git-filter repo-git-filter-search">
          <Search size={12} aria-hidden />
          <span className="sr-only">Search commits</span>
          <input
            ref={searchInputRef}
            className="input repo-git-filter-input"
            type="search"
            placeholder="Search all history or paste a hash…  ( / )"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search commits"
          />
        </label>
      </div>
      {hasFilters && (
        <div className="repo-git-filter-meta">
          {/*
            Says what was searched, not just how many rows survived. The old
            wording counted against the loaded page, so an empty result read as
            "no such commit" when it meant "not in the last 80".
          */}
          {searching
            ? `${filtered.length} match${filtered.length === 1 ? "" : "es"} across all history`
            : `Showing ${filtered.length} of ${commits.length} commit${commits.length === 1 ? "" : "s"}`}
          {authorFilter ? ` · ${authorFilter.displayName}` : ""}
          {unpushedOnly ? " · unpushed" : ""}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
            onClick={() => {
              setAuthorKey("");
              setSearchInput("");
              setSearch("");
              setUnpushedOnly(false);
              setPinnedHash(null);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      {relation?.mainBranch ? (
        <BranchRelationStrip
          relation={relation}
          acting={acting}
          pushing={pushing}
          unpushedCount={unpushedHashes.size}
          openPr={openPr}
          onFetch={() => void incoming("fetch")}
          onPull={() => void incoming("pull")}
          onPullRebase={() => void incoming("pull-rebase")}
          onPullMerge={() => void incoming("pull-merge")}
          onSync={() => void syncWithMain()}
          onPush={onPush}
        />
      ) : null}
      <RepoSplit
        className="repo-git-history-split"
        primaryFr={historyListFr}
        onPrimaryFrChange={setHistoryListFr}
        minPrimaryFr={0.28}
        maxPrimaryFr={0.62}
        stacked={stackHistory}
        handleLabel="Resize history list and detail"
        primary={
          <div className="repo-git-history-list">
            <CommitGraph
              commits={graphRows}
              selectedHash={selected}
              wip={wip}
              onOpenWip={onOpenWip}
              aheadOfMain={aheadOfMain}
              forkBase={forkBase}
              forkLabel={relation?.mainShort ?? null}
              aheadMain={relation?.aheadMain ?? 0}
              onSelect={(hash) => {
                setSelectedFile(null);
                setSelected(hash);
                // Any deliberate click hands the selection back to the filters.
                setPinnedHash(null);
              }}
              rowBind={(commit) => commitMenu.bindRow(commit)}
              onKebabOpen={(x, y, commit) => commitMenu.openAtPoint(x, y, commit)}
              onContextMenu={(_event, commit) => {
                setSelectedFile(null);
                setSelected(commit.hash);
                setPinnedHash(null);
              }}
              unpushedHashes={unpushedHashes}
              identityByEmail={identityByEmail}
              onRowDragStart={(event, commit) => {
                if (event.pointerType !== "mouse") return;
                branchDrag.start(event, commit);
              }}
              mainRefNames={
                relation?.mainShort
                  ? [relation.mainShort, `origin/${relation.mainShort}`, relation.mainBranch].filter(
                      (ref): ref is string => Boolean(ref),
                    )
                  : []
              }
            />
            {hasMore && (
              <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore && <RefreshCw size={11} className="animate-spin" />}
                  {loadingMore ? "Loading…" : "Load older commits"}
                </button>
              </div>
            )}
          </div>
        }
        secondary={
          <div className="repo-git-history-detail">
            {!selected ? (
              <div className="repo-git-empty">Select a commit to inspect its changes.</div>
            ) : !detailForSelection && detailLoading ? (
              <SkeletonRows count={10} height={14} />
            ) : detailForSelection ? (
              <>
                <div className="repo-git-commit-meta">
                  <div className="repo-git-commit-meta-main">
                    <div className="repo-git-commit-meta-top">
                      <span className="repo-git-graph-hash font-mono">{detailForSelection.shortHash}</span>
                      {selectedCommit && isUnpushed(selectedCommit) && (
                        <span className="repo-git-ref-chip" data-tone="warning">
                          unpushed
                        </span>
                      )}
                      {ciState && ciState.state !== "none" && (
                        <span
                          className="repo-git-ref-chip"
                          data-tone={ciState.state === "passing" ? "main" : ciState.state === "failing" ? "warning" : undefined}
                          title={
                            ciState.counts
                              ? `${ciState.counts.passed} passed · ${ciState.counts.failed} failed · ${ciState.counts.pending} pending`
                              : "CI checks"
                          }
                        >
                          ci {ciState.state}
                        </span>
                      )}
                      {detailForSelection.gpg === "G" && (
                        <span className="repo-git-ref-chip" title="Signed with a verified GPG signature">
                          <ShieldCheck size={10} aria-hidden /> verified
                        </span>
                      )}
                      {detailForSelection.parents[0] && (
                        <span className="text-xs text-text-subtle">
                          parent {detailForSelection.parents[0].slice(0, 7)}
                        </span>
                      )}
                    </div>
                    <div className="repo-git-commit-subject">{detailForSelection.subject}</div>
                    {detailForSelection.body ? (
                      <pre className="repo-git-commit-body">{detailForSelection.body}</pre>
                    ) : null}
                    <CommitContextChips repoName={repoName} commit={detailForSelection.hash} />
                    <div className="repo-git-commit-byline">
                      <span>
                        {detailIdentity?.displayName || detailForSelection.author}
                      </span>
                      {detailForSelection.authorEmail ? (
                        <span className="text-text-subtle">
                          &lt;{detailForSelection.authorEmail}&gt;
                        </span>
                      ) : null}
                      <span className="text-text-subtle">
                        {detailForSelection.relativeDate}
                        {detailForSelection.date
                          ? ` · ${detailForSelection.date.slice(0, 19).replace("T", " ")}`
                          : ""}
                      </span>
                    </div>
                    {canResetStashAhead && (
                      <div className="repo-git-commit-meta-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={acting !== null}
                          title={`Stash ${detailForSelection.aheadCount} commit${
                            detailForSelection.aheadCount === 1 ? "" : "s"
                          } ahead, then reset HEAD to this commit`}
                          onClick={() => void resetStashAhead()}
                        >
                          {acting === "reset-stash" ? (
                            <RefreshCw size={11} className="animate-spin" />
                          ) : (
                            <Layers size={11} />
                          )}
                          Stash ahead & reset
                          <span className="repo-git-commit-meta-actions-count">
                            {detailForSelection.aheadCount}
                          </span>
                        </button>
                      </div>
                    )}
                    {pinnedHash && !commits.some((c) => c.hash === pinnedHash) && (
                      <div className="repo-git-commit-meta-note">
                        Opened from Blame — this commit is older than the loaded history, so it
                        isn&apos;t highlighted in the list.
                      </div>
                    )}
                    {showDivergedNote && (
                      <div className="repo-git-commit-meta-note">
                        Not an ancestor of HEAD — stash-ahead reset is unavailable for diverged history.
                      </div>
                    )}
                  </div>
                  <div className="repo-git-commit-meta-avatar">
                    <CommitAvatar
                      author={detailIdentity?.displayName || detailForSelection.author}
                      email={detailForSelection.authorEmail}
                      size={56}
                      enlargeable
                      resolvedUrl={detailIdentity?.avatarUrl ?? undefined}
                      title={
                        detailForSelection.authorEmail
                          ? `${detailForSelection.author} <${detailForSelection.authorEmail}>`
                          : detailForSelection.author
                      }
                    />
                  </div>
                </div>
                <RepoSplit
                  className="repo-git-history-detail-grid"
                  primaryFr={filesFr}
                  onPrimaryFrChange={setFilesFr}
                  minPrimaryFr={0.18}
                  maxPrimaryFr={0.55}
                  stacked={stackDetail}
                  handleLabel="Resize file list and diff"
                  primary={
                    <div className="repo-git-commit-files">
                      <div className="repo-git-section-label">
                        Files
                        <span className="repo-git-section-label-end">{detailForSelection.files.length}</span>
                      </div>
                      {detailForSelection.files.length === 0 ? (
                        <div className="repo-git-empty-sm">No file changes in this commit.</div>
                      ) : (
                        detailForSelection.files.map((f) => (
                          <button
                            key={f.path}
                            type="button"
                            className="repo-git-commit-file"
                            data-active={activeFile === f.path || undefined}
                            onClick={() => setSelectedFile(f.path)}
                          >
                            <span className="repo-git-file-status">{f.status}</span>
                            <span className="font-mono truncate" title={f.path}>
                              {f.path}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  }
                  secondary={
                    <div className="repo-git-diff-pane">
                      <div className="repo-git-diff-head">
                        {activeFile ? (
                          <span className="font-mono truncate" title={activeFile}>
                            {activeFile}
                          </span>
                        ) : (
                          <span className="text-text-subtle">Select a file</span>
                        )}
                        <DiffToolbar
                          mode={contextMode}
                          onModeChange={setContextMode}
                          onMaximize={() => setDiffMaximized(true)}
                          maximizeDisabled={!activeFile}
                          openSlot={
                            activeFile && detailForSelection ? (
                              <>
                                <WhyExistsAction
                                  repoPath={repoPath}
                                  repoName={repoName}
                                  filePath={activeFile}
                                  disabled={detailLoading}
                                />
                                <RepoFileOpenMenu
                                  repoName={repoName}
                                  filePath={activeFile}
                                  commit={detailForSelection.hash}
                                  disabled={detailLoading}
                                />
                              </>
                            ) : null
                          }
                        />
                      </div>
                      <div className="repo-git-diff-body repo-git-diff-body-static">
                        {detailLoading ? (
                          <SkeletonRows count={8} height={14} />
                        ) : (
                          <GitDiffView
                            lines={detailForSelection.lines}
                            emptyMessage="No textual diff for this file (binary or empty)."
                          />
                        )}
                      </div>
                    </div>
                  }
                />
              </>
            ) : (
              <div className="repo-git-empty">Could not load commit detail.</div>
            )}
          </div>
        }
      />
      <ContextMenu
        open={Boolean(commitMenu.target)}
        position={commitMenu.position}
        groups={commitMenuGroups}
        onClose={commitMenu.close}
        label={commitMenu.target ? `Actions for ${commitMenu.target.shortHash}` : "Commit actions"}
      />
      <ContextMenu
        open={Boolean(dropMenu.target)}
        position={dropMenu.position}
        groups={dropMenuGroups}
        onClose={dropMenu.close}
        label={
          dropMenu.target
            ? `${dropMenu.target.commit.shortHash} onto ${dropMenu.target.branch}`
            : "Branch actions"
        }
      />
      {branchDrag.state &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="repo-git-drag-ghost"
            style={{ left: branchDrag.state.x + 10, top: branchDrag.state.y + 8 }}
            aria-hidden
          >
            <span className="font-mono">{branchDrag.state.payload.shortHash}</span>
            <span className="truncate">{branchDrag.state.payload.subject}</span>
          </div>,
          document.body,
        )}
      <DiffMaximizeModal
        maximized={diffMaximized}
        canOpen={Boolean(activeFile)}
        onClose={closeMaximized}
        title={activeFile ?? "Diff"}
        description={
          detailForSelection
            ? `${detailForSelection.shortHash} · ${detailForSelection.subject}`
            : undefined
        }
        mode={contextMode}
        onModeChange={setContextMode}
        openSlot={
          activeFile && detailForSelection ? (
            <>
              <WhyExistsAction
                repoPath={repoPath}
                repoName={repoName}
                filePath={activeFile}
                disabled={detailLoading}
              />
              <RepoFileOpenMenu
                repoName={repoName}
                filePath={activeFile}
                commit={detailForSelection.hash}
                disabled={detailLoading}
              />
            </>
          ) : null
        }
      >
        {detailLoading ? (
          <SkeletonRows count={12} height={14} />
        ) : detailForSelection ? (
          <GitDiffView
            lines={detailForSelection.lines}
            emptyMessage="No textual diff for this file (binary or empty)."
          />
        ) : null}
      </DiffMaximizeModal>
      {comparing ? (
        <RangeCompareModal
          repoName={repoName}
          open
          onClose={() => setComparing(false)}
          currentBranch={relation?.currentBranch}
        />
      ) : null}
      <RebasePlanModal
        open={Boolean(rebaseBase)}
        onClose={() => setRebaseBase(null)}
        repoName={repoName}
        base={rebaseBase}
        commits={filtered}
        onConflict={async (c) => {
          await onConflict?.(c);
          onMutate();
          await refresh();
        }}
        onDone={async () => {
          setSelectedFile(null);
          toast.success("History rewritten");
          onMutate();
          await refresh();
        }}
      />
    </div>
  );
}

function BranchRelationStrip({
  relation,
  acting,
  pushing,
  unpushedCount,
  openPr,
  onFetch,
  onPull,
  onPullRebase,
  onPullMerge,
  onSync,
  onPush,
}: {
  relation: BranchRelation;
  acting: string | null;
  pushing: boolean;
  unpushedCount: number;
  /** Open PR for this branch (lazy, best-effort). Null = no gh or no PR. */
  openPr?: { number: number; title: string; url: string; checks: string } | null;
  onFetch: () => void;
  onPull: () => void;
  onPullRebase: () => void;
  onPullMerge: () => void;
  onSync: () => void;
  onPush?: () => void;
}) {
  const main = relation.mainShort ?? "main";
  const ahead = relation.aheadMain;
  const behind = relation.behindMain;

  // A ticket key in the branch name (PTF-3774-fix-thing) links straight to
  // Jira — the branch is the unit of work, so its ticket belongs next to it.
  const branchTicket = relation.currentBranch.match(/([A-Z][A-Z0-9]{1,9}-\d+)/)?.[1] ?? null;

  let status: string;
  let tone: "ok" | "ahead" | "behind" | "diverged" | "merged";
  if (relation.onMain) {
    status = `On ${main}`;
    tone = "ok";
  } else if (relation.mergedIntoMain) {
    status =
      behind > 0
        ? `Merged into ${main} · ${behind} behind tip`
        : `Merged into ${main}`;
    tone = "merged";
  } else if (ahead > 0 && behind > 0) {
    status = `Diverged from ${main} · ↑${ahead} · ↓${behind}`;
    tone = "diverged";
  } else if (ahead > 0) {
    status = `↑${ahead} ahead of ${main}`;
    tone = "ahead";
  } else if (behind > 0) {
    status = `↓${behind} behind ${main}`;
    tone = "behind";
  } else {
    status = `Aligned with ${main}`;
    tone = "ok";
  }

  const relationTitle =
    "Ahead/behind vs default main (origin/" +
    main +
    "). Unpushed / Push counts are vs your upstream tracking branch — they can differ.";

  return (
    <div className="repo-git-branch-relation" data-tone={tone} title={relationTitle}>
      <div className="repo-git-branch-relation-viz" aria-hidden>
        <svg width="72" height="28" viewBox="0 0 72 28">
          {/* main lane */}
          <line x1="8" y1="8" x2="64" y2="8" stroke="var(--success)" strokeWidth="1.5" opacity="0.7" />
          <circle cx="64" cy="8" r="3.5" fill="var(--success)" />
          {/* branch lane */}
          {!relation.onMain && (
            <>
              <path
                d={
                  ahead > 0 || behind > 0 || relation.mergedIntoMain
                    ? "M 28 8 C 28 18, 36 20, 44 20"
                    : "M 28 8 L 44 20"
                }
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              <line
                x1="44"
                y1="20"
                x2={relation.mergedIntoMain ? "44" : "64"}
                y2="20"
                stroke="var(--accent)"
                strokeWidth="1.5"
                opacity="0.85"
              />
              {!relation.mergedIntoMain && (
                <circle cx="64" cy="20" r="3.5" fill="var(--accent)" />
              )}
              {relation.mergedIntoMain && (
                <circle cx="44" cy="20" r="3" fill="var(--accent)" opacity="0.7" />
              )}
            </>
          )}
          {relation.onMain && <circle cx="40" cy="8" r="3" fill="var(--accent)" />}
        </svg>
      </div>
      <div className="repo-git-branch-relation-copy">
        <div className="repo-git-branch-relation-title">
          <GitMerge size={11} aria-hidden />
          <span className="font-mono">{relation.currentBranch}</span>
          {branchTicket && (
            <a
              className="repo-git-context-chip"
              data-kind="ticket"
              href={jiraBrowseUrl(branchTicket)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${branchTicket} in Jira`}
            >
              {branchTicket}
            </a>
          )}
          {openPr && (
            <a
              className="repo-git-context-chip"
              data-kind="pr"
              data-checks={openPr.checks}
              href={openPr.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`PR #${openPr.number}: ${openPr.title} · checks ${openPr.checks}`}
            >
              PR #{openPr.number}
              <span className="repo-git-pr-checks" aria-hidden>
                {openPr.checks === "passing" ? "✓" : openPr.checks === "failing" ? "✕" : "◌"}
              </span>
            </a>
          )}
          <span className="text-text-subtle">vs</span>
          <span className="font-mono">{main}</span>
        </div>
        <div className="repo-git-branch-relation-status">{status}</div>
      </div>
      {!relation.onMain && (ahead > 0 || behind > 0) && (
        <div className="repo-git-branch-relation-counts" aria-label="Ahead and behind main">
          {ahead > 0 && <span data-dir="ahead">↑{ahead}</span>}
          {behind > 0 && <span data-dir="behind">↓{behind}</span>}
        </div>
      )}
      <div className="repo-git-branch-relation-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={acting !== null}
          onClick={onFetch}
          title="git fetch --all --prune — updates remote refs, leaves the working tree alone"
        >
          {acting === "fetch" ? (
            <RefreshCw size={11} className="animate-spin" aria-hidden />
          ) : (
            <Download size={11} aria-hidden />
          )}
          Fetch
        </button>
        {relation.upstream ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              data-active={relation.behindUpstream > 0 && relation.aheadUpstream === 0 || undefined}
              disabled={
                acting !== null ||
                relation.behindUpstream === 0 ||
                (relation.aheadUpstream > 0 && relation.behindUpstream > 0)
              }
              onClick={onPull}
              title={
                relation.aheadUpstream > 0 && relation.behindUpstream > 0
                  ? `Diverged from ${relation.upstream} — fast-forward pull will fail. Use rebase or merge.`
                  : relation.behindUpstream > 0
                    ? `git pull --ff-only — bring in ${relation.behindUpstream} commit${
                        relation.behindUpstream === 1 ? "" : "s"
                      } from ${relation.upstream}`
                    : `Up to date with ${relation.upstream}`
              }
            >
              {acting === "pull" ? (
                <RefreshCw size={11} className="animate-spin" aria-hidden />
              ) : (
                <CornerDownLeft size={11} aria-hidden />
              )}
              {relation.behindUpstream > 0 && relation.aheadUpstream === 0
                ? `Pull ${relation.behindUpstream}`
                : "Pull"}
            </button>
            {relation.aheadUpstream > 0 && relation.behindUpstream > 0 ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-active
                  disabled={acting !== null}
                  onClick={onPullRebase}
                  title="git pull --rebase — replay local commits on upstream"
                >
                  {acting === "pull-rebase" ? (
                    <RefreshCw size={11} className="animate-spin" aria-hidden />
                  ) : (
                    <CornerDownLeft size={11} aria-hidden />
                  )}
                  Pull rebase
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-active
                  disabled={acting !== null}
                  onClick={onPullMerge}
                  title="git pull --no-rebase — merge upstream into this branch"
                >
                  {acting === "pull-merge" ? (
                    <RefreshCw size={11} className="animate-spin" aria-hidden />
                  ) : (
                    <GitMerge size={11} aria-hidden />
                  )}
                  Pull merge
                </button>
              </>
            ) : null}
          </>
        ) : null}
        {/* Push and Sync used to be reachable only from the Branches tab, so the
            screen showing "11 ahead of main" offered no way to act on it. */}
        {onPush &&
        !(relation.aheadUpstream > 0 && relation.behindUpstream > 0) &&
        (unpushedCount > 0 || relation.aheadUpstream > 0 || pushing) ? (
          <button
            type="button"
            className="btn btn-ghost"
            data-active={!pushing || undefined}
            disabled={acting !== null || pushing}
            onClick={onPush}
            title={
              pushing
                ? "Push in progress…"
                : relation.upstream
                  ? `Push to ${relation.upstream}`
                  : "Push and start tracking origin — this branch has no upstream yet"
            }
          >
            {pushing ? (
              <RefreshCw size={11} className="animate-spin" aria-hidden />
            ) : (
              <Upload size={11} aria-hidden />
            )}
            {pushing
              ? "Pushing…"
              : `Push ${Math.max(unpushedCount, relation.aheadUpstream) || ""}`.trim()}
          </button>
        ) : null}
        {!relation.onMain && behind > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            data-active
            disabled={acting !== null}
            onClick={onSync}
            title={`Stash local work, merge ${relation.mainBranch ?? main}, push, then restore the stash`}
          >
            {acting === "sync-main" ? (
              <RefreshCw size={11} className="animate-spin" aria-hidden />
            ) : (
              <GitMerge size={11} aria-hidden />
            )}
            Sync {behind}
          </button>
        ) : null}
      </div>
    </div>
  );
}
