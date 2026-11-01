import { z } from "zod";
import { conventionsList, conventionsMarkdown, conventionsMine, conventionsMineInput, conventionsNativeReview, conventionsNativeSettings, conventionsNativeSettingsInput, conventionsReview, conventionsReviewInput, conventionsSettings, conventionsSettingsInput, conventionsSettingsRead, repoConventions } from "../../../../../../packages/shared/actions/conventions";
import { httpAction } from "../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../lib/api-utils";
import { AI_PROVIDER_IDS, aiProviderLabel, resolveAiProvider } from "../../../lib/ai/preference";
import { readAgentCliSettings } from "../../../lib/agent/cli-env";
import { addManualRule, deleteRule, editRule, RuleEditError, setRuleStatusWithUndo, undoRuleStatus } from "../../../lib/conventions/edit";
import { ensureConventionsFresh, resolveGithubRepo } from "../../../lib/conventions/fresh";
import { isMining, miningRepos, mineRepoConventions } from "../../../lib/conventions/miner";
import { readConventionsPrefs, saveConventionsPrefs } from "../../../lib/conventions/prefs";
import { renderConventionsMarkdown } from "../../../lib/conventions/render";
import { activeRules, isActive, summarize } from "../../../lib/conventions/rules";
import { conventionsFilePath, listConventions, readConventions, updateConventions } from "../../../lib/conventions/store";
import { pendingDecisions } from "../../../lib/conventions/prompt";
import { localGithubRepos } from "../../../lib/conventions/local-repos";
import { listOwnedRepos } from "../../../lib/ownership/owned-repos";


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

async function providerSettings() {
  const resolved = await resolveAiProvider();
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

export const GET = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const repo = params.get("repo") ?? undefined;
  const read = async () => {
    const response = await readConventionsResponse(req);
    return { status: response.status, body: await response.json() };
  };
  if (params.get("settings") === "1") {
    return httpAction(conventionsSettingsRead, {
      input: () => ({}),
      context: () => ({ read }),
      response: (response) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  if (params.get("settings") !== "1" && params.get("format") !== "markdown") {
    return httpAction(conventionsList, {
      input: () => ({ repo }),
      context: () => ({ list: read }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  if (repo?.trim() && params.get("format") === "markdown" && params.get("ensure") === "1") {
    return httpAction(repoConventions, {
      input: () => ({ repo }),
      context: () => ({ read }),
      response: (response) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  return httpAction(conventionsMarkdown, {
    input: () => ({ query: [...params.entries()] }),
    context: () => ({ read }),
    response: ({ status, body }) => Response.json(body, { status }),
  })(req);
}, "conventions.get");

async function readConventionsResponse(req: Request) {

  const params = new URL(req.url).searchParams;
  const prefs = readConventionsPrefs();

  if (params.get("settings") === "1") return Response.json({ prefs, ...await providerSettings() });

  const ref = params.get("repo")?.trim();
  if (!ref) {
    const files = listConventions();
    const repos = files.map((file) => summarize(file, isMining(file.repo)));
    const known = new Set(files.map((file) => file.repo.toLowerCase()));
    return Response.json({ prefs, repos, candidates: candidateRepos(known), mining: miningRepos() });
  }

  const repo = await resolveGithubRepo(ref);
  if (!repo) return Response.json({ error: `Not a GitHub repo: ${ref}` }, { status: 400 });

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
    return Response.json({
      repo,
      markdown,
      active: file ? activeRules(file).length : 0,
      status: markdown ? "ready" : mining ? "mining" : "none",
      updatedAt: lastOk?.at ?? null,
    });
  }

  return Response.json({
    repo,
    prefs,
    mining,
    /** Where the rules live on disk, so "where is this stored?" has an answer in the UI and over MCP. */
    storedAt: conventionsFilePath(repo),
    file: file ? { ...file, rules: file.rules.map((rule) => ({ ...rule, active: isActive(rule) })) } : null,
    summary: file ? summarize(file, mining) : null,
  });
}

const repoField = conventionsReviewInput.shape.repo.trim().min(3).max(200);
const categoryField = conventionsReviewInput.shape.category.unwrap();
const ruleIdField = conventionsReviewInput.shape.ruleId.unwrap().min(3).max(40);
const textField = conventionsReviewInput.shape.text.unwrap().max(400);
const whyField = conventionsReviewInput.shape.why.unwrap().max(400);
const scopeField = conventionsReviewInput.shape.scope.unwrap().max(120);
const undoTokenField = conventionsReviewInput.shape.undoToken.unwrap().min(1);

const PostSchema = z.discriminatedUnion("action", [
  conventionsMineInput.extend({ action: z.literal("mine"), repo: repoField }),
  z.object({ action: z.literal("undo"), repo: repoField, token: undoTokenField }),
  z.object({
    action: z.literal("status"),
    repo: repoField,
    ruleId: ruleIdField,
    status: z.enum(["suggested", "accepted", "rejected"]),
  }),
  z.object({
    action: z.literal("edit"),
    repo: repoField,
    ruleId: ruleIdField,
    text: textField.optional(),
    why: whyField.optional(),
    scope: scopeField.optional(),
    category: categoryField.optional(),
  }),
  z.object({
    action: z.literal("add"),
    repo: repoField,
    text: textField,
    why: whyField.optional(),
    scope: scopeField.optional(),
    category: categoryField.optional(),
  }),
  z.object({ action: z.literal("delete"), repo: repoField, ruleId: ruleIdField }),
  z.object({
    action: z.literal("prefs"),
    prefs: conventionsNativeSettingsInput,
  }),
]);

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.action === "mine") {
    return httpAction(conventionsMine, {
      input: () => ({ repo: body.repo, force: body.force }),
      context: () => ({ mine: async () => {
        const response = await applyConventionsAction(body);
        return { status: response.status, body: await response.json() };
      } }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  if ((body.action === "status" && body.status === "suggested") || (body.action === "add" && !body.text)) {
    return httpAction(conventionsNativeReview, {
      input: () => body,
      context: () => ({ review: async () => {
        const response = await applyConventionsAction(body);
        return { status: response.status, body: await response.json() };
      } }),
      response: (response) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  if (body.action !== "prefs") {
    const action = body.action === "status" ? (body.status === "accepted" ? "accept" : "reject") : body.action;
    return httpAction(conventionsReview, {
      input: () => ({
        repo: body.repo,
        action,
        ruleId: "ruleId" in body ? body.ruleId : undefined,
        text: "text" in body ? body.text : undefined,
        why: "why" in body ? body.why : undefined,
        scope: "scope" in body ? body.scope : undefined,
        category: "category" in body ? body.category : undefined,
        undoToken: body.action === "undo" ? body.token : undefined,
        confirm: true,
      }),
      context: () => ({ review: async () => {
        const response = await applyConventionsAction(body);
        return { status: response.status, body: await response.json() };
      } }),
      response: (result) => result.kind === "rejected"
        ? Response.json({ error: result.message }, { status: 400 })
        : Response.json(result.response.body, { status: result.response.status }),
    })(req);
  }
  const save = async () => {
    const response = await applyConventionsAction(body);
    return { status: response.status, body: await response.json() };
  };
  if (Object.values(body.prefs).some((value) => value !== undefined) && conventionsSettingsInput.safeParse(body.prefs).success) {
    return httpAction(conventionsSettings, {
      input: () => body.prefs,
      context: () => ({ read: save, save }),
      response: ({ response }) => Response.json(response.body, { status: response.status }),
    })(req);
  }
  return httpAction(conventionsNativeSettings, {
    input: () => body.prefs,
    context: () => ({ save }),
    response: (response) => Response.json(response.body, { status: response.status }),
  })(req);
}, "conventions.post");

async function applyConventionsAction(body: z.output<typeof PostSchema>) {

  if (body.action === "prefs") {
    const prefs = await saveConventionsPrefs({
      ...body.prefs,
      provider: body.prefs.provider === undefined ? undefined : (body.prefs.provider as never),
    });
    return Response.json({ ok: true, prefs });
  }

  // owner/repo, or a local repo folder name — agents often only know the latter.
  const fullName = await resolveGithubRepo(body.repo);
  if (!fullName) return Response.json({ error: `Not a GitHub repo: ${body.repo}` }, { status: 400 });

  if (body.action === "mine") {
    if (isMining(fullName)) return Response.json({ ok: true, started: false }, { status: 202 });
    // Minutes of model time: answer now, and let the page poll `mining`.
    void mineRepoConventions(fullName, { trigger: "manual", force: body.force }).catch((err: unknown) =>
      console.error(`[conventions] ${fullName}:`, err),
    );
    return Response.json({ ok: true, started: true }, { status: 202 });
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
    if (err instanceof RuleEditError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return Response.json({ ok: true, undoToken });
}
