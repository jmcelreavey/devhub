import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { AI_PROVIDER_IDS, aiProviderLabel, resolveAiProvider } from "@/lib/ai/preference";
import { readAgentCliSettings } from "@/lib/agent/cli-env";
import { addManualRule, deleteRule, editRule, RuleEditError, setRuleStatusWithUndo, undoRuleStatus } from "@/lib/conventions/edit";
import { ensureConventionsFresh, resolveGithubRepo } from "@/lib/conventions/fresh";
import { isMining, miningRepos, mineRepoConventions } from "@/lib/conventions/miner";
import { readConventionsPrefs, saveConventionsPrefs } from "@/lib/conventions/prefs";
import { renderConventionsMarkdown } from "@/lib/conventions/render";
import { activeRules, isActive, summarize } from "@/lib/conventions/rules";
import { conventionsFilePath, listConventions, readConventions, updateConventions } from "@/lib/conventions/store";
import { RULE_CATEGORIES } from "@/lib/conventions/types";
import { pendingDecisions } from "@/lib/conventions/prompt";
import { localGithubRepos } from "@/lib/conventions/local-repos";
import { listOwnedRepos } from "@/lib/ownership/owned-repos";

export const dynamic = "force-dynamic";

/** Repos you could mine but haven't: local clones with a GitHub remote, plus owned repos. */
function candidateRepos(known: ReadonlySet<string>): string[] {
  const found = new Map<string, string>();
  for (const { fullName } of localGithubRepos()) found.set(fullName.toLowerCase(), fullName);
  for (const owned of listOwnedRepos()) found.set(owned.fullName.toLowerCase(), owned.fullName);
  return [...found.entries()]
    .filter(([lower]) => !known.has(lower))
    .map(([, name]) => name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100);
}

function providerSettings() {
  const resolved = resolveAiProvider();
  const cli = readAgentCliSettings();
  return {
    providers: AI_PROVIDER_IDS.map((id) => ({ id, label: aiProviderLabel(id), available: resolved.availability[id] })),
    /** What a blank provider resolves to today. */
    resolved: resolved.provider,
    defaultModels: {
      "cursor-cli": cli.cursorModel,
      "chatgpt-cli": "",
      "antigravity-cli": cli.antigravityModel,
      opencode: cli.opencodeModel,
      api: process.env.AI_MODEL?.trim() || "",
    },
  };
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const prefs = readConventionsPrefs();

  if (params.get("settings") === "1") return NextResponse.json({ prefs, ...providerSettings() });

  const ref = params.get("repo")?.trim();
  if (!ref) {
    const files = listConventions();
    const repos = files.map((file) => summarize(file, isMining(file.repo)));
    const known = new Set(files.map((file) => file.repo.toLowerCase()));
    return NextResponse.json({ prefs, repos, candidates: candidateRepos(known), mining: miningRepos() });
  }

  const repo = await resolveGithubRepo(ref);
  if (!repo) return NextResponse.json({ error: `Not a GitHub repo: ${ref}` }, { status: 400 });

  // Agents call this first thing in a review; an empty answer starts the work
  // so the next call (or the next review) has something to return.
  if (params.get("ensure") === "1" || pendingDecisions(readConventions(repo)?.rules ?? []).length > 0) {
    await ensureConventionsFresh(repo, { trigger: "agent" });
  }

  const file = readConventions(repo);
  const mining = isMining(repo);

  if (params.get("format") === "markdown") {
    // `agent=0` is the UI's copy button: the "treat as data" frame is for agents, not for pasting into an AGENTS.md.
    const markdown = file ? renderConventionsMarkdown(file, { forAgent: params.get("agent") !== "0" }) : "";
    const lastOk = file?.runs.find((run) => run.ok);
    return NextResponse.json({
      repo,
      markdown,
      active: file ? activeRules(file).length : 0,
      status: markdown ? "ready" : mining ? "mining" : "none",
      updatedAt: lastOk?.at ?? null,
    });
  }

  return NextResponse.json({
    repo,
    prefs,
    mining,
    /** Where the rules live on disk, so "where is this stored?" has an answer in the UI and over MCP. */
    storedAt: conventionsFilePath(repo),
    file: file ? { ...file, rules: file.rules.map((rule) => ({ ...rule, active: isActive(rule) })) } : null,
    summary: file ? summarize(file, mining) : null,
  });
}, "conventions.get");

const repoField = z.string().trim().min(3).max(200);
const categoryField = z.enum(RULE_CATEGORIES);

const PostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mine"), repo: repoField, force: z.boolean().optional() }),
  z.object({ action: z.literal("undo"), repo: repoField, token: z.string().min(1).max(2_000) }),
  z.object({
    action: z.literal("status"),
    repo: repoField,
    ruleId: z.string().min(3).max(40),
    status: z.enum(["suggested", "accepted", "rejected"]),
  }),
  z.object({
    action: z.literal("edit"),
    repo: repoField,
    ruleId: z.string().min(3).max(40),
    text: z.string().max(400).optional(),
    why: z.string().max(400).optional(),
    scope: z.string().max(120).optional(),
    category: categoryField.optional(),
  }),
  z.object({
    action: z.literal("add"),
    repo: repoField,
    text: z.string().max(400),
    why: z.string().max(400).optional(),
    scope: z.string().max(120).optional(),
    category: categoryField.optional(),
  }),
  z.object({ action: z.literal("delete"), repo: repoField, ruleId: z.string().min(3).max(40) }),
  z.object({
    action: z.literal("prefs"),
    prefs: z.object({
      enabled: z.boolean().optional(),
      prLimit: z.number().int().optional(),
      minIntervalHours: z.number().int().optional(),
      provider: z.string().max(40).optional(),
      model: z.string().max(120).optional(),
    }),
  }),
]);

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === "prefs") {
    const prefs = await saveConventionsPrefs({
      ...body.prefs,
      provider: body.prefs.provider === undefined ? undefined : (body.prefs.provider as never),
    });
    return NextResponse.json({ ok: true, prefs });
  }

  // owner/repo, or a local repo folder name — agents often only know the latter.
  const fullName = await resolveGithubRepo(body.repo);
  if (!fullName) return NextResponse.json({ error: `Not a GitHub repo: ${body.repo}` }, { status: 400 });

  if (body.action === "mine") {
    if (isMining(fullName)) return NextResponse.json({ ok: true, started: false }, { status: 202 });
    // Minutes of model time: answer now, and let the page poll `mining`.
    void mineRepoConventions(fullName, { trigger: "manual", force: body.force }).catch((err: unknown) =>
      console.error(`[conventions] ${fullName}:`, err),
    );
    return NextResponse.json({ ok: true, started: true }, { status: 202 });
  }

  let undoToken: string | undefined;
  try {
    const now = new Date().toISOString();
    await updateConventions(fullName, (file) => {
      switch (body.action) {
        case "status":
          undoToken = setRuleStatusWithUndo(file, body.ruleId, body.status);
          return;
        case "undo":
          return undoRuleStatus(file, body.token);
        case "edit":
          return void editRule(file, body.ruleId, body);
        case "add":
          return void addManualRule(file, body, now);
        case "delete":
          return void deleteRule(file, body.ruleId);
      }
    });
  } catch (err) {
    if (err instanceof RuleEditError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ ok: true, undoToken });
}, "conventions.post");
