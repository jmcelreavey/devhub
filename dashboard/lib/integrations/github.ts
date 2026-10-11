import { z } from "zod";
import { prepareGithubWrite, executeGithubWrite } from "./github-write";
import { execGh, githubCliErrorInfo } from "@/lib/gh-exec";
import { accountConfig, accountsFor, credential } from "./accounts";
import { providerJson, statusError } from "./http";
import { IntegrationError, type IntegrationContext, type IntegrationItem, type IntegrationProvider, type IntegrationRef } from "./types";
const IssueSchema = z.object({ number: z.number(), title: z.string(), html_url: z.string().url(), state: z.string(), updated_at: z.string(), draft: z.boolean().optional(), head: z.object({ sha: z.string() }).optional() });
const SearchSchema = z.object({ items: z.array(IssueSchema), total_count: z.number() });
function pageNumber(cursor?: string) {
  if (cursor && !/^[1-9][0-9]{0,3}$/.test(cursor)) throw new IntegrationError("invalid", "Invalid GitHub page.");
  return Number(cursor || 1);
}
function issuePath(ref: IntegrationRef): { repo: string; number: string } {
  const match = ref.id.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/([1-9][0-9]*)$/);
  if (!match || !["issue", "pr"].includes(ref.kind)) throw new IntegrationError("invalid", "Use owner/repository/number for a GitHub issue or PR.");
  return { repo: match[1], number: match[2] };
}
export async function githubRequest(account: string, endpoint: string, context: IntegrationContext, method = "GET", body?: unknown): Promise<unknown> {
  if (account !== "default") {
    const config = accountConfig("github", account);
    return providerJson("https://api.github.com/" + endpoint, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential(config.tokenRef), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }, context.signal);
  }
  try {
    const result = await execGh(["api", "--method", method, endpoint, ...(body === undefined ? [] : ["--input", "-"])], { signal: context.signal, timeoutMs: 15000, input: body === undefined ? undefined : JSON.stringify(body) });
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  } catch (error) {
    if (context.signal.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    const status = message.match(/HTTP (\d{3})/);
    if (status) throw statusError(Number(status[1]));
    const info = githubCliErrorInfo(error);
    throw new IntegrationError(info.kind === "auth" ? "auth" : "unavailable", info.kind === "auth" ? "Sign in with gh auth login." : "GitHub CLI is unavailable or could not complete this request.");
  }
}
function item(ref: IntegrationRef, raw: z.infer<typeof IssueSchema>): IntegrationItem {
  return { ref, title: raw.title, url: raw.html_url, revision: raw.updated_at, status: { id: raw.state, label: raw.state }, draft: raw.draft, metadata: { github: { number: raw.number, headSha: raw.head?.sha } } };
}
export const githubProvider: IntegrationProvider = {
  id: "github", apiVersion: 1, label: "GitHub",
  capabilities: ["issue.read", "issue.search", "pr.read", "pr.search", "pr.checks", "pr.create", "pr.update", "pr.publish"],
  prepareWrite: prepareGithubWrite,
  executeWrite: executeGithubWrite,
  accounts: () => accountsFor("github"),
  async get(ref, context) {
    const { repo, number } = issuePath(ref);
    return item(ref, IssueSchema.parse(await githubRequest(ref.account, "repos/" + repo + "/" + (ref.kind === "pr" ? "pulls/" : "issues/") + number, context)));
  },
  async search(account, kind, query, cursor, context) {
    if (kind !== "issue" && kind !== "pr") throw new IntegrationError("unsupported", "Search supports issues and pull requests.");
    const page = pageNumber(cursor);
    const params = new URLSearchParams({ q: query + " is:" + kind, per_page: "30", page: String(page) });
    const result = SearchSchema.parse(await githubRequest(account, "search/issues?" + params, context));
    const items = result.items.map((raw) => {
      const url = new URL(raw.html_url);
      const parts = url.pathname.split("/").filter(Boolean);
      return item({ provider: "github", account, kind, id: parts.slice(0, 2).join("/") + "/" + raw.number }, raw);
    });
    return { items, next: page * 30 < Math.min(1000, result.total_count) ? String(page + 1) : undefined };
  },
  async checks(ref, context, cursor) {
    const page = pageNumber(cursor);
    const { repo, number } = issuePath(ref);
    if (ref.kind !== "pr") throw new IntegrationError("unsupported", "Checks belong to a pull request.");
    const pr = IssueSchema.parse(await githubRequest(ref.account, "repos/" + repo + "/pulls/" + number, context));
    if (!pr.head) throw new IntegrationError("unavailable", "GitHub did not return the pull request head.");
    const response = z.object({ total_count: z.number(), check_runs: z.array(z.object({ id: z.number(), name: z.string(), html_url: z.string().url(), status: z.string(), conclusion: z.string().nullable() })) }).parse(await githubRequest(ref.account, "repos/" + repo + "/commits/" + encodeURIComponent(pr.head.sha) + "/check-runs?per_page=100&page=" + page, context));
    return { next: page * 100 < response.total_count ? String(page + 1) : undefined, items: response.check_runs.map((check) => ({ ref: { provider: "github", account: ref.account, kind: "check" as const, id: repo + "/" + check.id }, title: check.name, url: check.html_url, revision: pr.head?.sha, status: { id: check.conclusion || check.status, label: check.conclusion || check.status } })) };
  },
};
