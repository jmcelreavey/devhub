/**
 * Mining one repo: read recent review feedback + the repo's guidance, ask a
 * model for rules, fold them into the store.
 *
 * Incremental by construction — a PR is only re-read when a reviewer has added
 * to it since the last run — so the steady-state cost of a repo that is merely
 * being reviewed is one GraphQL call and, usually, no model call at all.
 */
import { createHash } from "node:crypto";
import { formatGenerateError, generateAiText, type GenerateAiTextOptions, type GenerateAiTextResult } from "@/lib/ai/generate";
import { parseOwnerRepo } from "@/lib/github/repo-name";
import { feedbackFingerprint, pendingPrs, selectFeedback, type PrFeedback } from "./feedback";
import { fetchRepoFeedback, fetchRepoGuidance, type GuidanceDoc } from "./github";
import { mergeProposals } from "./merge";
import { readConventionsPrefs } from "./prefs";
import { buildMinePrompt, parseMineResponse, pendingDecisions, type MineProposal } from "./prompt";
import { readConventions, updateConventions } from "./store";
import { isSafeRuleText } from "./rules";
import type { MineRun, MineTrigger } from "./types";

export interface MineDeps {
  fetchFeedback: (repo: string, limit: number) => Promise<PrFeedback[]>;
  fetchGuidance: (repo: string) => Promise<GuidanceDoc[]>;
  generate: (opts: GenerateAiTextOptions) => Promise<GenerateAiTextResult>;
  now: () => Date;
}

const defaultDeps: MineDeps = {
  fetchFeedback: fetchRepoFeedback,
  fetchGuidance: fetchRepoGuidance,
  generate: generateAiText,
  now: () => new Date(),
};

export interface MineOptions {
  trigger: MineTrigger;
  /** Re-read every PR, not just the ones with new feedback. */
  force?: boolean;
  deps?: Partial<MineDeps>;
}

export type MineOutcome =
  | { status: "mined"; run: MineRun }
  | { status: "up-to-date" }
  | { status: "failed"; run: MineRun };

/** One model call at a time: ten reviews starting together must not become ten parallel agents. */
let queue: Promise<unknown> = Promise.resolve();
const inFlight = new Map<string, Promise<MineOutcome>>();

const key = (repo: string): string => repo.toLowerCase();

/**
 * Automatic checks that found nothing, or never got as far as reading anything,
 * for a repo with no rules file yet. They're remembered here, not written: with
 * access to hundreds of repos, merely asking about one would otherwise drop an
 * empty file into the vault for each. The throttle reads this alongside the file.
 */
const softChecks = new Map<string, { at: string; failed: boolean }>();

export function recentSoftCheck(repo: string): { at: string; failed: boolean } | undefined {
  return softChecks.get(key(repo));
}

export function isMining(repo: string): boolean {
  return inFlight.has(key(repo));
}

export function miningRepos(): string[] {
  return [...inFlight.keys()];
}

function hashGuidance(guidance: readonly GuidanceDoc[]): string {
  const hash = createHash("sha1");
  for (const doc of guidance) hash.update(`${doc.path}\n${doc.content}\n`);
  return hash.digest("hex").slice(0, 16);
}

async function mineOnce(repo: string, options: MineOptions): Promise<MineOutcome> {
  const deps: MineDeps = { ...defaultDeps, ...options.deps };
  const prefs = readConventionsPrefs();
  const startedAt = deps.now();
  const nowIso = startedAt.toISOString();
  const elapsed = (): number => deps.now().getTime() - startedAt.getTime();

  const fail = async (error: unknown, partial: Partial<MineRun> = {}): Promise<MineOutcome> => {
    const run: MineRun = {
      at: nowIso,
      trigger: options.trigger,
      ok: false,
      error: formatGenerateError(error),
      prsScanned: 0,
      comments: 0,
      considered: 0,
      added: 0,
      reinforced: 0,
      ms: elapsed(),
      guidanceFiles: [],
      ...partial,
    };
    // Failing to even reach GitHub, for a repo nobody asked about by hand, isn't worth a file.
    const readFeedback = partial.prsScanned !== undefined;
    if (options.trigger !== "manual" && !readFeedback && readConventions(repo) === null) {
      softChecks.set(key(repo), { at: nowIso, failed: true });
      return { status: "failed", run };
    }
    // Rules untouched: a failed run must never cost anyone their reviewed list.
    await updateConventions(repo, (file) => {
      file.checkedAt = nowIso;
      file.runs.unshift(run);
    });
    softChecks.delete(key(repo));
    return { status: "failed", run };
  };

  let feedback: PrFeedback[];
  let guidance: GuidanceDoc[];
  try {
    [feedback, guidance] = await Promise.all([deps.fetchFeedback(repo, prefs.prLimit), deps.fetchGuidance(repo)]);
  } catch (err) {
    return fail(err);
  }

  const existing = readConventions(repo);
  const guidanceHash = hashGuidance(guidance);
  const guidanceChanged = (guidance.length > 0 || existing?.guidanceHash !== undefined) &&
    (options.force === true || existing?.guidanceHash !== guidanceHash);
  const awaitingDecision = pendingDecisions(existing?.rules ?? []);
  const pending = pendingPrs(feedback, existing?.minedPrs ?? {}, options.force === true, startedAt.getTime());
  const { items, considered } = selectFeedback(pending, { now: startedAt.getTime() });

  // Nothing new to learn from. Still stamp the check so the throttle holds.
  if (items.length === 0 && !guidanceChanged && awaitingDecision.length === 0) {
    if (!existing && options.trigger !== "manual") {
      softChecks.set(key(repo), { at: nowIso, failed: false });
      return { status: "up-to-date" };
    }
    await updateConventions(repo, (file) => {
      file.checkedAt = nowIso;
      // Someone pressed the button: leave a run behind so the page can say "nothing to learn" rather than nothing.
      if (options.trigger === "manual") {
        file.runs.unshift({
          at: nowIso,
          trigger: "manual",
          ok: true,
          prsScanned: 0,
          comments: 0,
          considered: 0,
          added: 0,
          autoAccepted: 0,
          reinforced: 0,
          ms: elapsed(),
          guidanceFiles: guidance.map((doc) => doc.path),
        });
      }
    });
    softChecks.delete(key(repo));
    return { status: "up-to-date" };
  }

  const shape = { prsScanned: pending.length, comments: items.length, considered, guidanceFiles: guidance.map((doc) => doc.path) };

  let generated: GenerateAiTextResult;
  let proposals: MineProposal[];
  try {
    generated = await deps.generate({
      prompt: buildMinePrompt({ repo, items, guidance, existing: existing?.rules ?? [] }),
      prefer: prefs.provider || undefined,
      model: prefs.model || undefined,
      // A high-effort model took ~4 minutes on a typical repo; a stronger one needs more headroom.
      timeoutMs: 600_000,
      abortSignal: AbortSignal.timeout(600_000),
      idleTimeoutMs: 180_000,
      activity: { action: `Repo conventions · ${repo}` },
    });
    const parsed = parseMineResponse(generated.text);
    proposals = parsed.proposals;
    const decided = new Set(proposals
      .filter((proposal) => [proposal.text, proposal.why, proposal.scope, proposal.decisionReason].every((text) => text === undefined || isSafeRuleText(text)))
      .map((proposal) => proposal.id));
    // An incomplete assessment retries later; never silently reject omitted rules.
    if (awaitingDecision.some((rule) => !decided.has(rule.id))) {
      throw new Error("The model did not assess every existing suggestion. The current rules are unchanged.");
    }
  } catch (err) {
    return fail(err, shape);
  }

  let run!: MineRun;
  await updateConventions(repo, (file) => {
    // Merged into the file as it is *now*, so decisions made during the model call survive.
    const merged = mergeProposals(file, { repo, proposals, items, guidance, now: nowIso, guidanceChanged });
    // What the "has this PR changed since" check compares against next time.
    for (const pr of pending) file.minedPrs[String(pr.number)] = feedbackFingerprint(pr, startedAt.getTime());
    file.guidanceHash = guidanceHash;
    file.checkedAt = nowIso;
    run = {
      at: nowIso,
      trigger: options.trigger,
      ok: true,
      ...shape,
      added: merged.added,
      autoAccepted: merged.autoAccepted,
      autoRejected: merged.autoRejected,
      reinforced: merged.reinforced,
      ms: elapsed(),
      provider: generated.provider,
      model: prefs.model || "default",
    };
    file.runs.unshift(run);
  });
  softChecks.delete(key(repo));
  return { status: "mined", run };
}

/**
 * Mine a repo. Concurrent calls for the same repo share one run; calls for
 * different repos queue behind each other.
 */
export function mineRepoConventions(repo: string, options: MineOptions): Promise<MineOutcome> {
  if (!parseOwnerRepo(repo)) return Promise.reject(new Error(`Not a GitHub repo: ${repo}`));
  const running = inFlight.get(key(repo));
  if (running) return running;

  const tracked = queue.then(() => mineOnce(repo, options)).finally(() => {
    inFlight.delete(key(repo));
  });
  inFlight.set(key(repo), tracked);
  // The queue must survive a failed run, or one bad repo would wedge every later one.
  queue = tracked.catch(() => undefined);
  return tracked;
}
