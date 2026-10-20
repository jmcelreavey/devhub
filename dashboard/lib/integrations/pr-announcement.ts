import { z } from "zod";
import { parseGithubPrUrl } from "@/lib/entity-links/parse-pr";

export const SlackOwnerIdSchema = z.string().regex(/^U[A-Z0-9]{2,30}$/);
export const PR_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PrAnnouncementSchema = z.object({
  url: z.string().max(500).regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/).refine((url) => Boolean(parseGithubPrUrl(url))),
  title: z.string().trim().min(1).max(240),
  jira: z.string().regex(/^[A-Z][A-Z0-9_]{0,30}-[1-9]\d{0,12}$/).optional(),
  stage: z.enum(["opened", "ready"]).optional(),
  verdict: z.enum(["pass", "changes-requested"]).optional(),
  notes: z.number().int().min(0).max(999).optional(),
}).strict();
export type PrAnnouncement = z.infer<typeof PrAnnouncementSchema>;

export function isPrAlert(kind: string): kind is "pr-reviewed" | "pr-ready" {
  return kind === "pr-reviewed" || kind === "pr-ready";
}

export function freshPrAlert(at: string, now: number): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && time <= now && now - time <= PR_ALERT_MAX_AGE_MS;
}

/** Only these generated verdicts leave DevHub; never forward free-form review output. */
export function reviewVerdict(text = ""): Pick<PrAnnouncement, "verdict" | "notes"> {
  const match = text.split("\n").map((part) => part.replace(/[*_`]/g, "").trim())
    .map((part) => part.match(/^(?:verdict:\s*)?(looks good|pass|changes requested|needs changes)(?: with (\d{1,3}) notes?)?[.!]?$/i))
    .find((part) => part !== null);
  if (!match) return {};
  const verdict = /^(?:changes requested|needs changes)$/i.test(match[1]) ? "changes-requested" : "pass";
  return { verdict, ...(match[2] ? { notes: Number(match[2]) } : {}) };
}

export function announcementTitle(value: string): string {
  return value
    .replace(/(?:https?:\/\/|file:\/\/|(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|~\/)|[A-Z]:\\)\S+/gi, "[link or path]")
    .replace(/\b(?:xox[baprs]-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+)\b/g, "[redacted]")
    .replace(/\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 240);
}

function slackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\|/g, "¦").replace(/@/g, "＠").replace(/[*`~]/g, "");
}

export function prAnnouncementText(kind: "pr-reviewed" | "pr-ready", value: PrAnnouncement, ownerUserId: string): string {
  if (!SlackOwnerIdSchema.safeParse(ownerUserId).success) throw new Error("Configure the owner’s Slack user ID in Setup before sharing PR details.");
  const pr = PrAnnouncementSchema.parse(value);
  const identity = parseGithubPrUrl(pr.url)!;
  const title = slackText(announcementTitle(pr.title));
  const link = `<${pr.url}|${slackText(identity.repo)}#${identity.number} · ${title}>`;
  const owner = `<@${ownerUserId}>`;
  if (kind === "pr-ready" && pr.stage === "opened") return `${owner} opened a PR${pr.jira ? ` for ${slackText(pr.jira)}` : ""}: ${link}.`;
  if (kind === "pr-ready") return `${owner} your PR${pr.jira ? ` for ${slackText(pr.jira)}` : ""} is ready for a human review: ${link}.`;
  const verdict = pr.verdict === "pass" ? "looks good" : pr.verdict === "changes-requested" ? "needs changes" : undefined;
  return `${owner} your PR got an AI review: ${link}.${verdict ? ` Verdict: ${verdict}${pr.notes === undefined ? "" : ` with ${pr.notes} note${pr.notes === 1 ? "" : "s"}`}.` : ""}`;
}
