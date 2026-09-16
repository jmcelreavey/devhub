/**
 * Auto agent-review for review-requested PRs (P0).
 *
 * Selection is pure and unit-tested. Starting a review uses the same prompt /
 * note path as the UI "Review with agent" action, via OpenCode
 * (`/api/agent/run` seam) — never posts a GitHub review comment.
 */
import { ensureDevHubOpenCode } from "@/lib/opencode/listen";
import { agentReviewPrompt } from "@/lib/pr-review-prompt";
import { prNotePath } from "@/lib/pr-note";
import { reviewNotePathForPr } from "@/lib/github/review-requested-sort";
import { fetchMyGithubPrs, readGithubPrsListCache, type GithubPrRow } from "@/lib/github/prs";
import { fetchPrState } from "@/lib/github/pr-state";
import {
  getAutoPrReviewRecord,
  isSameReviewedHead,
  pruneStaleAutoPrReviews,
  recordAutoPrReviewStart,
  type AutoPrReviewRecord,
} from "@/lib/github/auto-pr-review-state";
import { pMap } from "@/lib/p-limit";

export type AutoReviewSkipReason =
  | "draft"
  | "not-allowlisted"
  | "already-reviewed-head"
  | "note-covers-updatedAt"
  | "concurrency-cap"
  | "dry-run";

export interface AutoReviewCandidate {
  row: GithubPrRow;
  notePath: string;
  reason?: AutoReviewSkipReason;
}

export interface AutoReviewStarted {
  repo: string;
  number: number;
  url: string;
  notePath: string;
  sessionId: string;
  updatedAt?: string;
}

export interface AutoReviewSkipped {
  repo: string;
  number: number;
  url: string;
  reason: AutoReviewSkipReason;
}

export interface AutoReviewError {
  repo: string;
  number: number;
  url: string;
  error: string;
}

export interface AutoReviewResult {
  dryRun: boolean;
  started: AutoReviewStarted[];
  skipped: AutoReviewSkipped[];
  errors: AutoReviewError[];
  /** Present on dry-run: PRs that would have been started. */
  candidates?: AutoReviewCandidate[];
}

export interface SelectAutoReviewInput {
  reviews: readonly GithubPrRow[];
  /** Extra draft URLs for rows whose `draft` flag is unknown (probed via `gh pr view`). */
  draftUrls?: ReadonlySet<string>;
  /** Optional repo allowlist (`owner/repo`). Empty/undefined = all repos. */
  allowlist?: ReadonlySet<string> | null;
  /** Note activity (mtime) keyed by vault path including `.json`. */
  noteActivityByPath?: ReadonlyMap<string, number>;
  /** Prior auto-review starts keyed by PR url. */
  priorByUrl?: ReadonlyMap<string, Pick<AutoPrReviewRecord, "updatedAt" | "headSha">>;
  /** Max reviews to start this pass (1–2 typical). */
  concurrency: number;
}

/** Cap on `gh pr view` probes per pass for rows whose draft flag is unknown. */
const MAX_DRAFT_PROBES = 12;

/** Draft check for a row the list query couldn't classify. Unreachable → not a draft. */
async function probeDraftViaGh(row: GithubPrRow): Promise<boolean> {
  try {
    return (await fetchPrState(row.repo, row.number)).isDraft;
  } catch {
    return false; // the start path surfaces real errors
  }
}

/** Review-requested rows for the endpoint and the poller alike. */
export async function loadAutoReviewQueue(): Promise<Pick<RunAutoPrReviewOptions, "reviews" | "probeDraft">> {
  const reviews = readGithubPrsListCache()?.reviews ?? (await fetchMyGithubPrs()).reviews;
  return { reviews, probeDraft: probeDraftViaGh };
}

function skipEntry(row: GithubPrRow, reason: AutoReviewSkipReason): AutoReviewSkipped {
  return { repo: row.repo, number: row.number, url: row.url, reason };
}

/**
 * Decide which review-requested PRs to start, which to skip, and why.
 * Does not touch the network — callers supply draft/allowlist/note/prior state.
 */
export function selectAutoReviewCandidates(input: SelectAutoReviewInput): {
  toStart: AutoReviewCandidate[];
  skipped: AutoReviewSkipped[];
} {
  const {
    reviews,
    draftUrls = new Set(),
    allowlist = null,
    noteActivityByPath = new Map(),
    priorByUrl = new Map(),
    concurrency,
  } = input;

  const cap = Math.max(1, Math.min(Math.trunc(concurrency) || 1, 8));
  const skipped: AutoReviewSkipped[] = [];
  const eligible: AutoReviewCandidate[] = [];

  for (const row of reviews) {
    if (row.draft === true || draftUrls.has(row.url)) {
      skipped.push(skipEntry(row, "draft"));
      continue;
    }
    if (allowlist && allowlist.size > 0 && !allowlist.has(row.repo)) {
      skipped.push(skipEntry(row, "not-allowlisted"));
      continue;
    }

    const updatedAt = row.updatedAt ?? "";
    const prior = priorByUrl.get(row.url);
    if (prior && isSameReviewedHead(prior, row)) {
      skipped.push(skipEntry(row, "already-reviewed-head"));
      continue;
    }

    const noteJsonPath = reviewNotePathForPr(row);
    const noteMs = noteActivityByPath.get(noteJsonPath);
    if (noteMs !== undefined && updatedAt) {
      const prMs = Date.parse(updatedAt);
      if (Number.isFinite(prMs) && noteMs >= prMs) {
        skipped.push(skipEntry(row, "note-covers-updatedAt"));
        continue;
      }
    }

    eligible.push({
      row,
      notePath: prNotePath({ repo: row.repo, number: row.number }),
    });
  }

  const toStart = eligible.slice(0, cap);
  for (const extra of eligible.slice(cap)) {
    skipped.push(skipEntry(extra.row, "concurrency-cap"));
  }
  return { toStart, skipped };
}

/** Parse `DEVHUB_AUTO_PR_REVIEW_REPOS=owner/a,owner/b` (empty = no filter). */
export function parseAutoReviewAllowlist(raw: string | undefined = process.env.DEVHUB_AUTO_PR_REVIEW_REPOS): Set<string> | null {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

export function autoReviewConcurrency(raw: string | undefined = process.env.DEVHUB_AUTO_PR_REVIEW_CONCURRENCY): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(n, 2));
}

function opencodeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim();
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  }
  return headers;
}

/**
 * Start one OpenCode review session — same prompt/note path as UI Review with agent.
 * Does not post GitHub review comments.
 */
export async function startOpenCodePrReview(opts: {
  row: GithubPrRow;
  notePath: string;
}): Promise<{ sessionId: string }> {
  const prompt = agentReviewPrompt(opts.row.url, opts.notePath);
  const text = `${prompt}\n\n(Write results via notes MCP to path: ${opts.notePath})`;
  const title = `Review PR #${opts.row.number}`.slice(0, 80);
  const base = `http://127.0.0.1:${await ensureDevHubOpenCode()}`;
  const headers = opencodeHeaders();

  const sessionRes = await fetch(`${base}/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title }),
  });
  if (!sessionRes.ok) {
    throw new Error(`OpenCode session create failed (${sessionRes.status})`);
  }
  const session = (await sessionRes.json()) as { id?: string };
  if (!session.id) throw new Error("OpenCode returned no session id");

  const promptRes = await fetch(`${base}/session/${session.id}/prompt_async`, {
    method: "POST",
    headers,
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
  });
  if (!promptRes.ok && promptRes.status !== 204) {
    throw new Error(`OpenCode prompt failed (${promptRes.status})`);
  }
  return { sessionId: session.id };
}

export interface RunAutoPrReviewOptions {
  reviews: readonly GithubPrRow[];
  /**
   * Checks rows whose `draft` flag is unknown (older list cache, failed meta
   * query). Only the rows about to start are probed. Omitted → unknown = not draft.
   */
  probeDraft?: (row: GithubPrRow) => Promise<boolean>;
  noteActivityByPath?: ReadonlyMap<string, number>;
  dryRun?: boolean;
  /** Override concurrency (else env, capped 1–2). */
  concurrency?: number;
  allowlist?: ReadonlySet<string> | null;
  /** Injected for tests. */
  startReview?: typeof startOpenCodePrReview;
}

/**
 * Select + optionally start auto reviews. Records starts for dedupe.
 * Callers load review-requested rows (already skip-until-updated filtered).
 */
export async function runAutoPrReview(opts: RunAutoPrReviewOptions): Promise<AutoReviewResult> {
  const dryRun = opts.dryRun === true;
  const allowlist = opts.allowlist === undefined ? parseAutoReviewAllowlist() : opts.allowlist;
  const concurrency = opts.concurrency ?? autoReviewConcurrency();

  await pruneStaleAutoPrReviews(opts.reviews);

  const priorByUrl = new Map(
    opts.reviews
      .map((r) => {
        const rec = getAutoPrReviewRecord(r.url);
        return rec ? ([r.url, rec] as const) : null;
      })
      .filter((x): x is readonly [string, AutoPrReviewRecord] => x !== null),
  );

  // Select, then probe only the chosen rows whose draft flag is unknown; a
  // draft among them frees its slot for the next row, so re-select.
  const draftUrls = new Set<string>();
  const probed = new Set<string>();
  const select = () =>
    selectAutoReviewCandidates({
      reviews: opts.reviews,
      draftUrls,
      allowlist,
      noteActivityByPath: opts.noteActivityByPath,
      priorByUrl,
      concurrency,
    });
  let selection = select();
  const unknownDraft = () =>
    selection.toStart.filter((c) => c.row.draft === undefined && !probed.has(c.row.url)).map((c) => c.row);
  for (let pending = unknownDraft(); opts.probeDraft && pending.length > 0; pending = unknownDraft()) {
    if (probed.size + pending.length > MAX_DRAFT_PROBES) {
      // Out of probe budget: skip what we couldn't check rather than risk a draft.
      pending.forEach((row) => draftUrls.add(row.url));
      selection = select();
      break;
    }
    const probe = opts.probeDraft;
    await pMap(pending, 3, async (row) => {
      probed.add(row.url);
      if (await probe(row)) draftUrls.add(row.url);
    });
    selection = select();
  }
  const { toStart, skipped } = selection;

  if (dryRun) {
    return {
      dryRun: true,
      started: [],
      skipped: [
        ...skipped,
        ...toStart.map((c) => skipEntry(c.row, "dry-run")),
      ],
      errors: [],
      candidates: toStart,
    };
  }

  const startReview = opts.startReview ?? startOpenCodePrReview;
  const started: AutoReviewStarted[] = [];
  const errors: AutoReviewError[] = [];

  // Cap parallel OpenCode starts to the same concurrency budget.
  await pMap(toStart, concurrency, async (candidate) => {
    const { row, notePath } = candidate;
    try {
      const { sessionId } = await startReview({ row, notePath });
      await recordAutoPrReviewStart({
        url: row.url,
        updatedAt: row.updatedAt ?? "",
        headSha: row.headSha,
        repo: row.repo,
        number: row.number,
        title: row.title,
        sessionId,
        notePath,
      });
      started.push({
        repo: row.repo,
        number: row.number,
        url: row.url,
        notePath,
        sessionId,
        updatedAt: row.updatedAt,
      });
    } catch (err) {
      errors.push({
        repo: row.repo,
        number: row.number,
        url: row.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { dryRun: false, started, skipped, errors };
}
