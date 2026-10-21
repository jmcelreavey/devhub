import { z } from "zod";
import { githubRequest } from "./github";
import { IntegrationError, type IntegrationContext } from "./types";
import type { WriteInput, PreparedWrite, WriteContext, WriteReceipt } from "./write-types";

const Pr = z.object({ number: z.number(), node_id: z.string(), title: z.string(), body: z.string().nullable(), html_url: z.string(), state: z.string(), draft: z.boolean(), updated_at: z.string(), head: z.object({ sha: z.string(), ref: z.string() }), base: z.object({ sha: z.string(), ref: z.string() }) });
const User = z.object({ login: z.string(), id: z.number() });
const USER_TTL_MS = 5 * 60_000;
const users = new Map<string, { at: number; user: z.infer<typeof User> }>();
/** Each `gh api` call is a process spawn; the signed-in user does not change between clicks. */
async function currentUser(account: string, context: IntegrationContext) {
  const hit = users.get(account);
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.user;
  const user = User.parse(await githubRequest(account, "user", context));
  users.set(account, { at: Date.now(), user });
  return user;
}
export function clearGithubUserCache() { users.clear(); }

export async function prepareGithubWrite(input: WriteInput, context: IntegrationContext): Promise<PreparedWrite> {
  if (input.provider !== "github") throw new IntegrationError("unsupported", "Choose a GitHub action.");
  if (input.action === "pr.create") {
    if (input.head === input.base) throw new IntegrationError("invalid", "Choose different head and base branches.");
    const readBranch = async (name: string) => z.object({ commit: z.object({ sha: z.string() }) }).parse(await githubRequest(input.account, "repos/" + input.repo + "/branches/" + encodeURIComponent(name), context)).commit.sha;
    // None of these depend on each other, so they run together instead of one process spawn after another.
    const [user, headSha, baseSha, existing] = await Promise.all([
      currentUser(input.account, context), readBranch(input.head), readBranch(input.base),
      githubRequest(input.account, "repos/" + input.repo + "/pulls?" + new URLSearchParams({ state: "open", head: input.repo.split("/")[0] + ":" + input.head, base: input.base }), context).then((raw) => z.array(z.object({ number: z.number() })).parse(raw)),
    ]);
    const actor = user.login + " (" + user.id + ")";
    if (existing.length) throw new IntegrationError("conflict", "A pull request already exists for these branches. Update that PR instead.");
    return { destination: "https://github.com/" + input.repo, actor, summary: input.draft ? "Create draft pull request" : "Publish pull request",
      details: { repository: input.repo, head: input.head, base: input.base, title: input.title, body: input.body, draft: input.draft, headSha, baseSha },
      native: { actorId: user.id, headSha, baseSha, payload: { title: input.title, body: input.body, head: input.head, base: input.base, draft: input.draft } } };
  }
  const parts = input.ref.id.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/([1-9][0-9]*)$/);
  if (!parts) throw new IntegrationError("invalid", "Use owner/repository/number for the pull request.");
  const endpoint = "repos/" + parts[1] + "/pulls/" + parts[2];
  const [user, raw] = await Promise.all([currentUser(input.account, context), githubRequest(input.account, endpoint, context)]);
  const actor = user.login + " (" + user.id + ")";
  const pr = Pr.parse(raw);
  if (pr.state !== "open") throw new IntegrationError("conflict", "Only open pull requests can be changed.");
  if (input.action === "pr.publish" && !pr.draft) throw new IntegrationError("conflict", "This pull request is already published.");
  return { destination: pr.html_url, actor, summary: input.action === "pr.publish" ? "Mark PR #" + pr.number + " ready for review" : "Update PR #" + pr.number,
    details: input.action === "pr.publish" ? { title: pr.title, head: pr.head.ref, base: pr.base.ref, headSha: pr.head.sha } : { previousTitle: pr.title, previousBody: pr.body ?? "", title: input.title, body: input.body },
    native: { actorId: user.id, endpoint, nodeId: pr.node_id, revision: pr.updated_at, headSha: pr.head.sha, baseSha: pr.base.sha, payload: input.action === "pr.update" ? { title: input.title, body: input.body } : null } };
}
export async function executeGithubWrite(input: WriteInput, prepared: PreparedWrite, context: WriteContext): Promise<WriteReceipt> {
  if (input.provider !== "github" || !context.requestId) throw new IntegrationError("unsupported", "A GitHub action is required.");
  if (input.action === "pr.publish") {
    const result = z.object({ errors: z.array(z.unknown()).optional(), data: z.object({ markPullRequestReadyForReview: z.object({ pullRequest: z.object({ url: z.string() }) }).nullable() }).nullable().optional() }).parse(await githubRequest(input.account, "graphql", context, "POST", {
      query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{url}}}", variables: { id: prepared.native.nodeId },
    }));
    if (result.errors?.length || !result.data?.markPullRequestReadyForReview) throw new IntegrationError("unavailable", "GitHub did not confirm publication. Check the PR before trying again.");
    return { detail: prepared.summary, item: { ref: input.ref, title: String(prepared.details.title), url: result.data.markPullRequestReadyForReview.pullRequest.url } };
  }
  const endpoint = input.action === "pr.create" ? "repos/" + input.repo + "/pulls" : String(prepared.native.endpoint);
  const result = z.object({ number: z.number(), html_url: z.string(), title: z.string() }).parse(await githubRequest(input.account, endpoint, context, input.action === "pr.create" ? "POST" : "PATCH", prepared.native.payload));
  const repository = input.action === "pr.create" ? input.repo : input.ref.id.split("/").slice(0, 2).join("/");
  return { detail: prepared.summary, item: { ref: { provider: "github", account: input.account, kind: "pr", id: repository + "/" + result.number }, title: result.title, url: result.html_url } };
}
