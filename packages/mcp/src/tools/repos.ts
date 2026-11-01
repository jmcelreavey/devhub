import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { reposList, repoClone, repoLearn, repoOpen, repoReveal, repoGitBlame, repoGitBranch, repoGitBranches, repoGitCi, repoGitCommit, repoGitConflicts, repoGitDiff, repoGitDiscard, repoGitLog, repoGitPush, repoGitRange, repoGitShow, repoGitStage, repoGitStageHunk, repoGitStash, repoGitStatus, repoGitWorktrees, repoWorktreeCleanup, type ReposListResult, type RepoGitStatusData } from "../../../../packages/shared/actions/repos.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";
import {
  capText,
  formatGitBlame,
  formatGitBranches,
  formatGitDiff,
  formatGitLog,
  formatGitShow,
  formatGitStatus,
  type GitBlamePayload,
  type GitBranchesPayload,
  type GitDiffPayload,
  type GitLogPayload,
  type GitShowPayload,
} from "./git-format.ts";

function repoPath(name: string, sub: string): string {
  return `/api/repos/${encodeURIComponent(name)}${sub}`;
}

function jsonText(data: unknown, fallback = "OK"): string {
  if (typeof data === "string") return data || fallback;
  // Compact: indentation alone was ~30% of these payloads.
  return JSON.stringify(data);
}

function executeDashboardAction(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return withDashboardErrors(async () => await operation() as DashboardToolResult);
}

export function registerReposTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server,
    reposList,
    { list: () => dashboard.get<ReposListResult>("/api/repos") },
    (data) => {
        if (!data.repos?.length) {
          return {
            content: [
              {
                type: "text",
                text: `No repos found${data.scanDirDisplay ? ` under ${data.scanDirDisplay}` : ""}.`,
              },
            ],
          };
        }
        const lines = data.repos.map((r) => {
          const flags = [
            r.branch ?? "(detached)",
            r.dirtyCount ? `${r.dirtyCount} dirty` : null,
            r.unpushedCount ? `${r.unpushedCount} unpushed` : null,
            r.hasCompose ? "compose" : null,
          ]
            .filter(Boolean)
            .join(", ");
          return `- ${r.name} [${flags}]`;
        });
        return { content: [{ type: "text", text: `Repos (${data.repos.length}):\n${lines.join("\n")}` }] };
      },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoOpen,
    { open: async (name) => ({ status: 200, body: await dashboard.post<{ ok: boolean; path: string }>(repoPath(name, "/open"), {}) }) },
    ({ name, response }) => ({ content: [{ type: "text", text: `Opened ${name} (${(response.body as { path: string }).path}).` }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoReveal,
    { reveal: async (name) => ({ status: 200, body: await dashboard.post<{ ok: boolean; path: string; label?: string }>(repoPath(name, "/reveal")) }) },
    ({ name, response }) => {
        const r = response.body as { path?: string; label?: string };
        return {
          content: [
            {
              type: "text",
              text: `Revealed ${name}${r.path ? ` (${r.path})` : ""}${r.label ? ` in ${r.label}` : ""}.`,
            },
          ],
        };
      },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoClone,
    { clone: async ({ fullName }) => ({
      status: 200,
      body: await dashboard.post<{ ok: boolean; repo?: { name?: string; path?: string } }>("/api/repos/clone", { fullName }, 120_000),
    }) },
    ({ fullName, response }) => {
      const result = response.body as { repo?: { path?: string } };
      return { content: [{ type: "text", text: `Cloned ${fullName}${result.repo?.path ? ` → ${result.repo.path}` : ""}.` }] };
    },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoLearn,
    { learn: async ({ name, refresh }) => ({
      status: 200,
      body: await dashboard.get<Record<string, unknown>>(repoPath(name, "/learn"), { refresh: refresh ? "1" : undefined }, 70_000),
    }) },
    (result) => {
        const payload = result.body as Record<string, unknown>;
        const summary =
          typeof payload.summary === "string"
            ? payload.summary
            : typeof payload.markdown === "string"
              ? payload.markdown
              : JSON.stringify(payload);
        return { content: [{ type: "text", text: summary }] };
      },
    executeDashboardAction,
  );

  // ── Git workspace (proxies /api/repos/:name/git/* + branches) ─────────────

  registerAction(
    server,
    repoGitStatus,
    { getStatus: async (name) => ({ ok: true, data: await dashboard.get<RepoGitStatusData>(repoPath(name, "/git/status")) }) },
    (result) => result.ok
      ? { content: [{ type: "text", text: formatGitStatus(result.data) }] }
      : { content: [{ type: "text", text: result.error }], isError: true },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitStage,
    { stage: async ({ name, action, paths }) => ({
      status: 200,
      body: await dashboard.post(repoPath(name, "/git/stage"), { action, paths: paths ?? [] }),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, `${result.action} OK`) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitDiscard,
    { discard: async ({ name, paths, scope }) => ({
      status: 200,
      body: await dashboard.post(repoPath(name, "/git/stage"), { action: "discard", paths, scope }),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, "Discarded") }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitStageHunk,
    { stageHunk: async ({ name, path: filePath, action, rawDiff, hunkIndex, lineIndexes }) => ({
      status: 200,
      body: await dashboard.post(repoPath(name, "/git/stage"), { action, path: filePath, rawDiff, hunkIndex, lineIndexes }),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, `${result.action} OK`) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitDiff,
    { diff: async ({ name, path: filePath, staged, context }) => ({
      status: 200,
      body: await dashboard.get<GitDiffPayload>(repoPath(name, "/git/diff"), { path: filePath, staged: staged ? "1" : undefined, context }),
    }) },
    (result) => ({ content: [{ type: "text", text: formatGitDiff(result.response.body as GitDiffPayload, result.path ?? "the working tree") }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitStash,
    { stash: async ({ name, action, ref, message }) => ({
      status: 200,
      body: action === "list"
        ? await dashboard.get(repoPath(name, "/git/stash"))
        : await dashboard.post(repoPath(name, "/git/stash"), { action, ref, message }),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview"
      ? result.message
      : jsonText(result.response.body, result.action === "list" ? "OK" : `Stash ${result.action} OK`) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitBranches,
    { listBranches: async (name) => ({ status: 200, body: await dashboard.get<GitBranchesPayload>(repoPath(name, "/branches")) }) },
    (result) => ({ content: [{ type: "text", text: formatGitBranches(result.body as GitBranchesPayload) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitBranch,
    { branch: async ({ name, action, branch }) => ({
      status: 200,
      body: await dashboard.post(repoPath(name, "/branches"), { action, branch },
        action === "push" || action === "fetch" || action === "pull" ? 310_000 : 60_000),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, `${result.action} OK`) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitCommit,
    { commit: async ({ name, message, amend }) => ({
      status: 200,
      body: await dashboard.post(repoPath(name, "/branches"), { action: "commit", message, amend: Boolean(amend) }),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, result.amend ? "Amended" : "Committed") }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitPush,
    { push: async ({ name }) => ({ status: 200, body: await dashboard.post(repoPath(name, "/branches"), { action: "push" }, 310_000) }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview" ? result.message : jsonText(result.response.body, "Pushed") }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitLog,
    { log: async ({ name, limit, offset, scope, query }) => ({
      status: 200,
      body: await dashboard.get<GitLogPayload>(repoPath(name, "/git/log"), { limit: limit ?? 40, offset: offset ?? 0, scope, q: query }),
    }) },
    (result) => ({ content: [{ type: "text", text: formatGitLog(result.body as GitLogPayload) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitShow,
    { show: async ({ name, ref, path: filePath }) => ({
      status: 200,
      body: await dashboard.get<GitShowPayload>(repoPath(name, "/git/show"), { commit: ref, path: filePath }),
    }) },
    (result) => ({ content: [{ type: "text", text: formatGitShow(result.body as GitShowPayload) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitBlame,
    { blame: async ({ name, path: filePath, line }) => ({
      status: 200,
      body: await dashboard.get<GitBlamePayload>(repoPath(name, "/git/blame"), { path: filePath, line }, 60_000),
    }) },
    (result) => ({ content: [{ type: "text", text: formatGitBlame(result.response.body as GitBlamePayload, { startLine: result.startLine, endLine: result.endLine }) }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitConflicts,
    { conflicts: async ({ name, action, path: filePath, content, expectedContent }) => ({
      status: 200,
      body: action === "resolve"
        ? await dashboard.post(repoPath(name, "/git/conflicts"), { action, path: filePath, content, expectedContent })
        : await dashboard.get(repoPath(name, "/git/conflicts")),
    }) },
    (result) => ({ content: [{ type: "text", text: result.kind === "preview"
      ? result.message
      : jsonText(result.response.body, result.action === "list" ? "OK" : "Resolved") }] }),
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitRange,
    { range: async ({ name, base, head, path: filePath, context }) => ({
      status: 200,
      body: await dashboard.get<{
          base: string;
          head: string;
          ahead: number;
          behind: number;
          files: { path: string; status: string }[];
          lines: { text: string }[];
        }>(repoPath(name, "/git/range"), { base, head, path: filePath, context }, 60_000),
    }) },
    ({ response, filesOnly }) => {
        const data = response.body as {
          base: string;
          head: string;
          ahead: number;
          behind: number;
          files: { path: string; status: string }[];
          lines: { text: string }[];
        };
        const header =
          `${data.base}...${data.head}: ${data.ahead} commit(s) ahead, ${data.behind} behind.\n` +
          `Files (${data.files.length}):\n${data.files.map((f) => `${f.status} ${f.path}`).join("\n") || "(none)"}`;
        if (filesOnly || data.files.length === 0) return { content: [{ type: "text", text: header }] };
        const patch = data.lines.map((l) => l.text).join("\n");
        const body = capText(patch, "pass path for one file, or filesOnly to list files");
        return { content: [{ type: "text", text: `${header}\n\n${body}` }] };
      },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitCi,
    { ci: async ({ name, commit }) => ({
      status: 200,
      body: commit
        ? await dashboard.get(repoPath(name, "/git/ci"), { commit }, 60_000)
        : await dashboard.get(repoPath(name, "/git/branch-pr"), undefined, 60_000),
    }) },
    ({ commit, response }) => {
        type Counts = { passed: number; failed: number; pending: number };
        const fmt = (c?: Counts) => (c ? ` (${c.passed} passed, ${c.failed} failed, ${c.pending} pending)` : "");
        if (commit) {
          const data = response.body as { state: string; counts?: Counts; reason?: string };
          const reason = data.reason ? ` — ${data.reason}` : "";
          return { content: [{ type: "text", text: `CI for ${commit}: ${data.state}${fmt(data.counts)}${reason}` }] };
        }
        const data = response.body as {
          pr: { number: number; title: string; url: string; checks: string; checkCounts: Counts } | null;
        };
        if (!data.pr) {
          return {
            content: [
              { type: "text", text: "No open PR for the current branch (or detached HEAD / gh unavailable)." },
            ],
          };
        }
        const pr = data.pr;
        return {
          content: [
            { type: "text", text: `PR #${pr.number} ${pr.title}\n${pr.url}\nChecks: ${pr.checks}${fmt(pr.checkCounts)}` },
          ],
        };
      },
    executeDashboardAction,
  );

  registerAction(
    server,
    repoGitWorktrees,
    { worktrees: async ({ name, action = "list", branch, path: target, createBranch, force, entries, includeIgnored }) => {
        if (action === "review") {
          const data = await dashboard.get<{ mergedCleanupSupported?: boolean }>(repoPath(name, "/worktrees"), { details: "1" }, 180_000);
          if (!data.mergedCleanupSupported) throw new Error("Rebuild the DevHub dashboard to enable verified merged-worktree cleanup.");
          return { status: 200, body: data };
        }
        if (action === "cleanup") {
          const capabilities = await dashboard.get<{ mergedCleanupSupported?: boolean }>(repoPath(name, "/worktrees"));
          if (!capabilities.mergedCleanupSupported) throw new Error("Rebuild the DevHub dashboard to enable verified merged-worktree cleanup.");
          const data = await dashboard.post<{ removed: string[]; errors: { path: string; error: string }[] }>(
            repoPath(name, "/worktrees"), { entries, confirmed: true, includeIgnored: includeIgnored ?? false, mergedOnly: true }, 300_000,
          );
          return { status: 200, body: data };
        }
        if (action === "list") {
          const data = await dashboard.get<{
            worktrees: {
              path: string;
              head: string;
              branch: string | null;
              isMain: boolean;
              detached: boolean;
              locked: boolean;
              prunable: boolean;
            }[];
          }>(repoPath(name, "/git/worktrees"));
          return { status: 200, body: data };
        }
        const data = await dashboard.post<{ ok: boolean; path?: string; message?: string }>(
          repoPath(name, "/git/worktrees"),
          { action, branch, path: target, createBranch, force },
          130_000,
        );
        return { status: 200, body: data };
      } },
    (result) => {
        if (result.kind === "rejected") return { isError: true, content: [{ type: "text", text: result.message }] };
        if (result.action === "review") return { content: [{ type: "text", text: jsonText(result.response.body) }] };
        if (result.action === "cleanup") {
          const data = result.response.body as { removed: string[]; errors: { path: string; error: string }[] };
          return { isError: data.errors.length > 0, content: [{ type: "text", text: jsonText(data) }] };
        }
        if (result.action === "list") {
          const data = result.response.body as { worktrees: { path: string; head: string; branch: string | null; isMain: boolean; detached: boolean; locked: boolean; prunable: boolean }[] };
          const lines = data.worktrees.map((w) => {
            const flags = [
              w.isMain ? "main" : null,
              w.detached ? "detached" : null,
              w.locked ? "locked" : null,
              w.prunable ? "prunable" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `- ${w.path} — ${w.branch ?? w.head.slice(0, 9)}${flags ? ` [${flags}]` : ""}`;
          });
          return { content: [{ type: "text", text: `Worktrees (${lines.length}):\n${lines.join("\n")}` }] };
        }
        const data = result.response.body as { path?: string; message?: string };
        const detail = data.path ? ` → ${data.path}` : data.message ? `\n${data.message}` : "";
        return { content: [{ type: "text", text: `Worktree ${result.action} OK${detail}` }] };
      },
    executeDashboardAction,
  );
  registerAction(
    server,
    repoWorktreeCleanup,
    {
      list: async () => ({ status: 200, body: await dashboard.get("/api/repos/worktree-cleanup", undefined, 180_000) }),
      remove: async (items, dryRun) => ({
        status: 200,
        body: await dashboard.post("/api/repos/worktree-cleanup", { items, ...(dryRun ? { dryRun: true } : {}) }, 300_000),
      }),
    },
    (result) => {
      if (result.kind === "rejected") return { isError: true, content: [{ type: "text", text: result.message }] };
      if (result.kind === "listed") return { content: [{ type: "text", text: jsonText(result.response.body) }] };
      return { content: [{ type: "text", text: jsonText({ dryRun: result.dryRun, ...(result.response.body as Record<string, unknown>) }) }] };
    },
    executeDashboardAction,
  );
}
