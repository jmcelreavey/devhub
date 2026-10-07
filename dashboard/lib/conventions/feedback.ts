/**
 * From raw PR feedback to the handful of comments worth a model's attention.
 *
 * Pure and deterministic on purpose: this is the step that decides what the
 * (expensive, stochastic) model gets to see, so it should be the part you can
 * unit-test and reason about. A comment survives if a human other than the PR
 * author wrote it, it says something, and it scores — convention language and
 * "the author changed the code in response" score highest.
 */

import { createHash } from "node:crypto";

export type FeedbackKind = "inline" | "review" | "conversation";

export interface FeedbackComment {
  id: string;
  url: string;
  author: string;
  isBot: boolean;
  /** GitHub `authorAssociation`; blank when unknown. */
  association: string;
  body: string;
  at: string;
  path?: string;
  resolved?: boolean;
  outdated?: boolean;
  /**
   * "The developer agreed and changed it": the code at this spot changed after
   * the comment (the thread went outdated) and the author closed the loop by
   * resolving the thread or explicitly confirming the change in a later reply. Stronger than either alone — a
   * resolved thread can be a question answered with "no", an outdated one can
   * just be a rebase.
   */
  actedOn?: boolean;
  kind: FeedbackKind;
}

export interface PrFeedback {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  author: string;
  updatedAt: string;
  comments: FeedbackComment[];
}

export interface FeedbackItem {
  /** 1-based; the only handle the model has on a comment, so it cannot invent a URL. */
  index: number;
  prNumber: number;
  prTitle: string;
  author: string;
  url: string;
  path?: string;
  body: string;
  at: string;
  resolved: boolean;
  actedOn: boolean;
  kind: FeedbackKind;
  score: number;
}

export interface SelectOptions {
  maxItems?: number;
  maxChars?: number;
  itemChars?: number;
  /** Epoch ms the age cutoff is measured from; injectable so tests don't rot. */
  now?: number;
}

/**
 * A convention last voiced years ago is weak evidence — teams move on, and old
 * PRs get touched by bots and bulk edits, which puts them in "recent" lists.
 * Seen live: the newest 30 PRs of a repo included #3 and #6 from 2019.
 */
const MAX_COMMENT_AGE_MS = 548 * 86_400_000;

/** Association values that mean "this person is part of the team". Drive-by accounts are ignored. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const KNOWN_BOTS = /(\[bot\]|^github-actions|^dependabot|^codecov|^sonar|^renovate|^copilot|^vercel|^netlify|^snyk|^coderabbit|^linear|^jira)/i;

const CONVENTION_LANGUAGE = new RegExp(
  [
    "\\bpattern\\b",
    "\\bconvention",
    "\\bwe (usually|always|typically|prefer|don'?t|do not|never|use|have|keep|put)\\b",
    "\\bour (way|approach|standard|style|pattern|convention|setup)\\b",
    "\\bthe way we\\b",
    "\\bshould (be|use|live|go|follow|match)\\b",
    "\\bplease (use|follow|move|rename|keep|add|put|match)\\b",
    "\\binstead of\\b",
    "\\brather than\\b",
    "\\bconsistent(ly)? with\\b",
    "\\bexisting (pattern|code|helper|file|structure)\\b",
    "\\bfollow(s|ing)? (the|our|this)\\b",
    "\\bguideline",
    "\\bbest practice",
    "\\bseparate (file|module|handler)",
  ].join("|"),
  "i",
);

/** One or more stock acknowledgements, so "looks good to me, thanks" counts as trivia too. */
const TRIVIAL =
  /^(?:(?:lgtm|looks good(?: to me)?|approved?|thanks?|thank you|nice|great|good (?:catch|call)|\+1|👍|:shipit:|ship it|ok(?:ay)?|done|fixed|will do|makes sense|agreed?)(?:[\s,.!;:-]+|$))+$/i;

/** Drop quoted reply text and suggestion fences — the words around them carry the rule. */
function cleanBody(body: string): string {
  return body
    .replace(/^>.*$/gm, "")
    .replace(/```suggestion[\s\S]*?```/g, "[suggested change]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isSubstantive(comment: FeedbackComment, prAuthor: string, now: number = Date.now()): boolean {
  if (comment.isBot || KNOWN_BOTS.test(comment.author)) return false;
  const age = now - Date.parse(comment.at);
  if (Number.isFinite(age) && age > MAX_COMMENT_AGE_MS) return false;
  if (comment.author.toLowerCase() === prAuthor.toLowerCase()) return false;
  if (comment.association && !TRUSTED_ASSOCIATIONS.has(comment.association.toUpperCase())) return false;
  const body = cleanBody(comment.body);
  if (body.length < 20) return false;
  if (body.length < 60 && TRIVIAL.test(body)) return false;
  return true;
}

export function scoreComment(comment: FeedbackComment, body: string): number {
  let score = 1;
  const hasConventionLanguage = CONVENTION_LANGUAGE.test(body);
  if (hasConventionLanguage) score += 3;
  if (comment.actedOn) score += 3;
  else if (comment.resolved) score += 1;
  if (comment.path) score += 1;
  if (comment.kind === "review" && !hasConventionLanguage) score -= 1;
  if (/^nit\b/i.test(body) && !hasConventionLanguage) score -= 2;
  return score;
}

/** Substantive comments on one PR, used for both selection and change detection. */
export function substantiveComments(pr: PrFeedback, now: number = Date.now()): FeedbackComment[] {
  return pr.comments.filter((comment) => isSubstantive(comment, pr.author, now));
}

/** A reply or resolution can change acceptance without adding a reviewer comment. */
export function feedbackFingerprint(pr: PrFeedback, now: number = Date.now()): string {
  const comments = substantiveComments(pr, now)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((comment) => [comment.id, comment.body, comment.path, comment.resolved === true, comment.outdated === true, comment.actedOn === true]);
  return createHash("sha256").update(JSON.stringify(comments)).digest("hex");
}

/** PRs with new or edited feedback, including changes to thread acceptance. */
export function pendingPrs(
  prs: readonly PrFeedback[],
  minedPrs: Readonly<Record<string, number | string>>,
  force = false,
  now: number = Date.now(),
): PrFeedback[] {
  return prs.filter((pr) => {
    const count = substantiveComments(pr, now).length;
    if (count === 0) return false;
    return force || minedPrs[String(pr.number)] !== feedbackFingerprint(pr, now);
  });
}

export interface Selection {
  items: FeedbackItem[];
  /** Substantive comments seen before the caps. */
  considered: number;
}

export function selectFeedback(prs: readonly PrFeedback[], options: SelectOptions = {}): Selection {
  const { maxItems = 80, maxChars = 28_000, itemChars = 700, now = Date.now() } = options;

  const scored: Omit<FeedbackItem, "index">[] = [];
  for (const pr of prs) {
    for (const comment of substantiveComments(pr, now)) {
      const body = cleanBody(comment.body);
      scored.push({
        prNumber: pr.number,
        prTitle: pr.title,
        author: comment.author,
        url: comment.url,
        path: comment.path,
        body: body.length > itemChars ? `${body.slice(0, itemChars)}…` : body,
        at: comment.at,
        resolved: comment.resolved === true,
        actedOn: comment.actedOn === true,
        kind: comment.kind,
        score: scoreComment(comment, body),
      });
    }
  }

  const considered = scored.length;
  scored.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at));

  const kept: Omit<FeedbackItem, "index">[] = [];
  let chars = 0;
  for (const item of scored) {
    if (kept.length >= maxItems) break;
    if (chars + item.body.length > maxChars) continue;
    kept.push(item);
    chars += item.body.length;
  }

  // Back into reading order — newest PR first, comments within a PR as written —
  // so the model sees each thread's context rather than a score-sorted jumble.
  kept.sort((a, b) => b.prNumber - a.prNumber || a.at.localeCompare(b.at));
  return { items: kept.map((item, i) => ({ ...item, index: i + 1 })), considered };
}
