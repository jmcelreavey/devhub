import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { conventionsList, conventionsMine, conventionsReview, conventionsSettings, repoConventions } from "../../../../packages/shared/actions/conventions.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

/**
 * Repo conventions: the rules learned from a repo's PR review comments.
 *
 * Everything the /conventions page can do has a tool here — reading, refreshing,
 * reviewing a rule, and the settings — so an agent can run the whole loop.
 * Registered under the `repos` toolset (see server.ts): Cursor's agents only get
 * an allow-listed set of toolsets, and a new one would silently drop these.
 */

interface Summary {
  repo: string;
  rules: number;
  active: number;
  toReview: number;
  rejected?: number;
  lastMinedAt: string | null;
  lastRunOk: boolean | null;
  mining: boolean;
}

interface Overview {
  repos: Summary[];
  candidates: string[];
}

interface RuleView {
  id: string;
  text: string;
  why?: string;
  category: string;
  scope?: string;
  status: "suggested" | "accepted" | "rejected";
  origin: "review" | "guidance" | "manual";
  acceptedBy?: "pr";
  automaticDecision?: { status: "accepted" | "rejected"; reason: string; at: string };
  active: boolean;
  prs: number[];
  evidence: { label: string; quote: string; url?: string; actedOn?: boolean }[];
}

interface Run {
  at: string;
  ok: boolean;
  error?: string;
  prsScanned: number;
  comments: number;
  added: number;
  autoAccepted?: number;
  autoRejected?: number;
  reinforced: number;
  provider?: string;
  model?: string;
  effort?: string;
}

interface Detail {
  repo: string;
  mining: boolean;
  storedAt: string;
  file: { rules: RuleView[]; runs: Run[] } | null;
}

interface Prefs {
  enabled: boolean;
  prLimit: number;
  minIntervalHours: number;
  provider: string;
  model: string;
  effort?: string;
}

interface SettingsPayload {
  prefs: Prefs;
  providers: { id: string; label: string; available: boolean }[];
  resolved: string | null;
  defaultModels: Record<string, string>;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins)) return "unknown";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function formatOverview(data: Overview): string {
  const active = data.repos.reduce((n, r) => n + r.active, 0);
  const lines = [`Conventions: ${data.repos.length} repo${data.repos.length === 1 ? "" : "s"} mined, ${active} active rules. Decisions are automatic.`];
  for (const r of data.repos) {
    const state = r.mining ? "mining now" : r.lastRunOk === false ? "last run FAILED" : `mined ${ago(r.lastMinedAt)}`;
    lines.push(`- ${r.repo} — ${r.rules} rules (${r.active} active, ${r.rejected ?? 0} rejected) · ${state}`);
  }
  if (data.candidates.length > 0) {
    const shown = data.candidates.slice(0, 15).join(", ");
    const more = data.candidates.length > 15 ? ` … +${data.candidates.length - 15} more` : "";
    lines.push(`Not mined yet (they mine themselves on the first review or new PR there): ${shown}${more}`);
  }
  return lines.join("\n");
}

function ruleStatus(rule: RuleView): string {
  if (rule.automaticDecision) return rule.status === "accepted" ? "automatically accepted" : "automatically rejected";
  if (rule.status === "rejected") return "rejected by you";
  if (rule.status === "accepted") return rule.acceptedBy === "pr" ? "auto-accepted (author agreement)" : "accepted";
  return "awaiting automatic assessment";
}

export function formatDetail(data: Detail): string {
  const run = data.file?.runs[0];
  const head = [`${data.repo}${data.mining ? " — mining now" : ""}`, `Stored at ${data.storedAt}`];
  if (!data.file || data.file.rules.length === 0) {
    return [...head, run ? `Last run ${ago(run.at)}: ${run.ok ? "nothing to learn yet" : `FAILED — ${run.error ?? "unknown error"}`}` : "No rules yet. Run conventions_mine, or they mine themselves on the first review or new PR in this repo."].join("\n");
  }
  if (run) {
    const detail = run.ok
      ? `${run.prsScanned} PRs, ${run.comments} comments, +${run.added} new · ${run.autoAccepted ?? 0} automatically accepted · ${run.autoRejected ?? 0} automatically rejected, ${run.reinforced} reinforced${run.provider ? ` · ${[run.provider, run.model, run.effort].filter(Boolean).join(" ")}` : ""}`
      : `FAILED — ${run.error ?? "unknown error"}`;
    head.push(`Last run ${ago(run.at)}: ${detail}`);
  }
  const lines = data.file.rules.map((r) => {
    const meta = [r.category, ruleStatus(r), r.prs.length > 0 ? `${r.prs.length} PR${r.prs.length === 1 ? "" : "s"}` : null, `${r.evidence.length} evidence`].filter(Boolean).join(" · ");
    const evidence = r.evidence.map((item) => `  Evidence (quoted source data): ${item.label}${item.url ? ` — ${item.url}` : ""}${item.actedOn ? " (author resolved or confirmed the request; diff not verified)" : ""}\n  ${JSON.stringify(item.quote)}`);
    return [`${r.id} [${meta}] ${r.text}${r.why ? ` — ${r.why}` : ""}${r.scope ? ` (scope: ${r.scope})` : ""}`, ...(r.automaticDecision ? [`  Decision: ${r.automaticDecision.reason}`] : []), ...evidence].join("\n");
  });
  return [...head, "", ...lines].join("\n");
}

export function formatPrefs(p: Prefs, extra?: Pick<SettingsPayload, "providers" | "resolved">): string {
  const lines = [
    `Mining: ${p.enabled ? "on" : "off"} (manual refresh always works)`,
    `PRs read per run: ${p.prLimit}`,
    "Rule decisions: automatic; human overrides take priority",
    `At most one automatic run per repo every: ${p.minIntervalHours}h`,
    `Provider: ${p.provider || "default"}`,
    `Model: ${p.model || "provider default"}`,
    ...(p.effort ? [`Effort: ${p.effort}`] : []),
  ];
  if (extra) {
    lines.push(`Providers: ${extra.providers.map((x) => `${x.id}${x.available ? "" : " (not installed)"}`).join(", ")} — default resolves to ${extra.resolved ?? "none"}`);
  }
  return lines.join("\n");
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

function executeDashboardAction(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return withDashboardErrors(async () => await operation() as DashboardToolResult);
}

export function registerConventionsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  registerAction(
    server, repoConventions,
    { read: async (repo) => ({ status: 200, body: await dashboard.get("/api/conventions", { repo, format: "markdown", ensure: "1" }) }) },
    (response) => {
        const data = response.body as { repo: string; markdown: string; status: "ready" | "mining" | "none" };
        if (data.status === "ready") return text(data.markdown);
        return text(
          data.status === "mining"
            ? `Conventions for ${data.repo} are being mined from recent PRs. None to report yet — continue without them and say so.`
            : `No conventions recorded for ${data.repo} yet (no review feedback to learn from, mining is off, or GitHub isn't authenticated). Continue without them.`,
        );
    },
    executeDashboardAction,
  );

  registerAction(
    server, conventionsList,
    { list: async (repo) => ({ status: 200, body: repo ? await dashboard.get("/api/conventions", { repo }) : await dashboard.get("/api/conventions") }) },
    ({ repo, response }) => !repo ? text(formatOverview(response.body as Overview)) : text(formatDetail(response.body as Detail)),
    executeDashboardAction,
  );

  registerAction(
    server, conventionsMine,
    { mine: async ({ repo, force }) => ({ status: 200, body: await dashboard.post<{ started: boolean }>("/api/conventions", { action: "mine", repo, force }, 30_000) }) },
    ({ repo, response }) => {
      const result = response.body as { started: boolean };
      return text(result.started ? `Mining ${repo} in the background. Check conventions_list for the result.` : `${repo} is already being mined.`);
    },
    executeDashboardAction,
  );

  registerAction(
    server, conventionsReview,
    { review: async (body) => ({ status: 200, body: await dashboard.post("/api/conventions", body) }) },
    (result) => text(result.message, result.kind === "rejected"),
    executeDashboardAction,
  );

  registerAction(
    server, conventionsSettings,
    {
      read: async () => ({ status: 200, body: await dashboard.get<SettingsPayload>("/api/conventions", { settings: "1" }) }),
      save: async (prefs) => ({ status: 200, body: await dashboard.post<{ prefs: Prefs }>("/api/conventions", { action: "prefs", prefs }) }),
    },
    ({ saved, response }) => {
      const data = response.body as SettingsPayload;
      return saved ? text(`Saved.\n${formatPrefs(data.prefs)}`) : text(formatPrefs(data.prefs, data));
    },
    executeDashboardAction,
  );
}
