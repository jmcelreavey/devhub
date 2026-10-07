import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

/**
 * Repo conventions: the rules learned from a repo's PR review comments.
 *
 * Everything the /conventions page can do has a tool here — reading, refreshing,
 * reviewing a rule, and the settings — so an agent can run the whole loop.
 * Registered under the `repos` toolset (see server.ts): Cursor's agents only get
 * an allow-listed set of toolsets, and a new one would silently drop these.
 */

const CATEGORIES = ["structure", "config", "naming", "testing", "errors", "security", "performance", "style", "process", "other"] as const;

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
      ? `${run.prsScanned} PRs, ${run.comments} comments, +${run.added} new · ${run.autoAccepted ?? 0} automatically accepted · ${run.autoRejected ?? 0} automatically rejected, ${run.reinforced} reinforced${run.provider ? ` · ${[run.provider, run.model].filter(Boolean).join(" ")}` : ""}`
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
  ];
  if (extra) {
    lines.push(`Providers: ${extra.providers.map((x) => `${x.id}${x.available ? "" : " (not installed)"}`).join(", ")} — default resolves to ${extra.resolved ?? "none"}`);
  }
  return lines.join("\n");
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function registerConventionsTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "repo_conventions",
    {
      description:
        "This repo's team conventions, learned from its PR review comments and its AGENTS.md / CONTRIBUTING. Call it before reviewing a PR in the repo or opening one, and check the code against what it returns. Pass owner/repo (or the local repo folder name). When the repo has none yet it starts mining them in the background — carry on without and say so. Requires the dashboard running.",
      inputSchema: { repo: z.string().describe("owner/repo, or a local repo name as shown by repos_list") },
    },
    async ({ repo }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ repo: string; markdown: string; status: "ready" | "mining" | "none" }>("/api/conventions", {
          repo,
          format: "markdown",
          ensure: "1",
        });
        if (data.status === "ready") return text(data.markdown);
        return text(
          data.status === "mining"
            ? `Conventions for ${data.repo} are being mined from recent PRs. None to report yet — continue without them and say so.`
            : `No conventions recorded for ${data.repo} yet (no review feedback to learn from, mining is off, or GitHub isn't authenticated). Continue without them.`,
        );
      }),
  );

  server.registerTool(
    "conventions_list",
    {
      description:
        "List repos that have conventions (active and rejected rules, when each was mined). With a repo: every rule with its id, status, evidence links and quoted feedback, plus where the file is stored — the ids are what conventions_review takes. Requires the dashboard running.",
      inputSchema: {
        repo: z.string().optional().describe("owner/repo or local repo name; omit for the overview"),
        status: z.enum(["accepted", "rejected"]).optional().describe("With a repo: active rules or rejected candidates; omit for both"),
      },
    },
    async ({ repo, status }) =>
      withDashboardErrors(async () => {
        if (!repo) return text(formatOverview(await dashboard.get<Overview>("/api/conventions")));
        const data = await dashboard.get<Detail>("/api/conventions", { repo });
        if (status && data.file) data.file = { ...data.file, rules: data.file.rules.filter((rule) => rule.status === status) };
        return text(formatDetail(data));
      }),
  );

  server.registerTool(
    "conventions_mine",
    {
      description:
        "Refresh a repo's conventions from its recent PRs now (the Refresh from PRs button). Runs in the background — a model call, a few minutes — and only reads PRs with new review feedback; force:true re-reads every recent PR. Check progress with conventions_list. Requires the dashboard running and the GitHub CLI authenticated.",
      inputSchema: {
        repo: z.string().describe("owner/repo or local repo name"),
        force: z.boolean().optional().describe("Re-read every recent PR, not just those with new feedback"),
      },
    },
    async ({ repo, force }) =>
      withDashboardErrors(async () => {
        const r = await dashboard.post<{ started: boolean }>("/api/conventions", { action: "mine", repo, force }, 30_000);
        return text(r.started ? `Mining ${repo} in the background. Check conventions_list for the result.` : `${repo} is already being mined.`);
      }),
  );

  server.registerTool(
    "conventions_review",
    {
      description:
        "Review one rule, the same actions as the /conventions page: accept, reject (it won't be proposed again), restore (reinstate as active), edit (rewording accepts it), add (a rule you write yourself, accepted), delete (only rules you added; needs confirm:true), undo (revert a decision using its returned undoToken, provided the rule has not changed). Get rule ids from conventions_list. Requires the dashboard running.",
      inputSchema: {
        repo: z.string().describe("owner/repo or local repo name"),
        action: z.enum(["accept", "reject", "restore", "edit", "add", "delete", "undo"]),
        ruleId: z.string().optional().describe("Required for everything except add and undo"),
        text: z.string().optional().describe("The rule: required for add, optional for edit"),
        why: z.string().optional(),
        scope: z.string().optional().describe("A path or glob the rule applies to"),
        category: z.enum(CATEGORIES).optional(),
        confirm: z.boolean().optional().describe("Must be true for delete"),
        undoToken: z.string().max(2_000).optional().describe("Token returned by accept, reject or restore; required for undo"),
      },
    },
    async ({ repo, action, ruleId, text: ruleText, why, scope, category, confirm, undoToken }) =>
      withDashboardErrors(async () => {
        if (action === "undo") {
          if (!undoToken) return text("undo needs the undoToken returned by the decision.", true);
          await dashboard.post("/api/conventions", { action: "undo", repo, token: undoToken });
          return text(`Decision undone in ${repo}.`);
        }
        if (action !== "add" && !ruleId) return text(`${action} needs a ruleId — see conventions_list.`, true);
        if (action === "add" && !ruleText) return text("add needs the rule text.", true);
        if (action === "delete" && !confirm) return text("delete removes a rule you added for good. Pass confirm:true to go ahead.", true);

        const body =
          action === "add"
            ? { action: "add", repo, text: ruleText, why, scope, category }
            : action === "edit"
              ? { action: "edit", repo, ruleId, text: ruleText, why, scope, category }
              : action === "delete"
                ? { action: "delete", repo, ruleId }
                : { action: "status", repo, ruleId, status: ({ accept: "accepted", reject: "rejected", restore: "accepted" } as const)[action] };
        const result = await dashboard.post<{ undoToken?: string }>("/api/conventions", body);
        return text(`${action} done${ruleId ? ` for ${ruleId}` : ""} in ${repo}.${result.undoToken ? `\nUndo token: ${result.undoToken}` : ""}`);
      }),
  );

  server.registerTool(
    "conventions_settings",
    {
      description:
        "Read the conventions settings, or change them by passing any fields (the page's Settings panel): mining on/off, PRs read per run, the minimum gap between automatic runs, and the provider and model used for mining. With no fields it just reads. Requires the dashboard running.",
      inputSchema: {
        enabled: z.boolean().optional().describe("Automatic mining on or off; manual refresh always works"),
        prLimit: z.number().int().min(5).max(50).optional(),
        minIntervalHours: z.number().int().min(1).max(168).optional(),
        provider: z.string().optional().describe("cursor-cli | chatgpt-cli | antigravity-cli | opencode | api; empty string = the default provider"),
        model: z.string().optional().describe("Model for mining; empty string = the provider's own"),
      },
    },
    async (fields) =>
      withDashboardErrors(async () => {
        const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length === 0) {
          const s = await dashboard.get<SettingsPayload>("/api/conventions", { settings: "1" });
          return text(formatPrefs(s.prefs, s));
        }
        const r = await dashboard.post<{ prefs: Prefs }>("/api/conventions", { action: "prefs", prefs: patch });
        return text(`Saved.\n${formatPrefs(r.prefs)}`);
      }),
  );
}
