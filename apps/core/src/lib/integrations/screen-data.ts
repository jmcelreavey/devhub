/**
 * Native screen projections keep existing Jira/PR response shapes while provider
 * selection and capability checks live at the integration boundary.
 * Jira and PR views use the default account.
 */
import { getMyTickets, getTicket, getJiraMeta } from "../jira/client";
import { fetchMyGithubPrs, fetchRecentlyReviewedPrs, isRepoArchived, searchIssues } from "../github/prs";
import { fetchPrState } from "../github/pr-state";
import { execGh } from "../gh-exec";
import { providerFor } from "./registry";
import { assertCapability, IntegrationError } from "./types";

async function defaultProvider(id: string, capability: string) {
  const provider = providerFor(id);
  assertCapability(provider, capability);
  if (!(await provider.accounts()).some((a) => a.id === "default")) throw new IntegrationError("not-found", "The default integration account is unavailable.");
  return provider;
}
export const jiraScreen = {
  async tickets() { await defaultProvider("jira", "issue.search"); return getMyTickets(); },
  async ticket(...args: Parameters<typeof getTicket>) { await defaultProvider("jira", "issue.read"); return getTicket(...args); },
  async meta(...args: Parameters<typeof getJiraMeta>) { await defaultProvider("jira", "issue.create"); return getJiraMeta(...args); },
  async transitions(key: string) {
    const provider = await defaultProvider("jira", "issue.transitions");
    if (!provider.transitions) throw new IntegrationError("unsupported", "Jira transitions are unavailable.");
    const transitions = await provider.transitions({ provider: "jira", account: "default", kind: "issue", id: key }, { signal: AbortSignal.timeout(15000) });
    return transitions.map((t) => ({ id: t.id, name: t.label, to: t.statusLabel ?? t.label }));
  },
};
export const githubScreen = {
  async prs(...args: Parameters<typeof fetchMyGithubPrs>) { await defaultProvider("github", "pr.search"); return fetchMyGithubPrs(...args); },
  async recentlyReviewed(...args: Parameters<typeof fetchRecentlyReviewedPrs>) { await defaultProvider("github", "pr.search"); return fetchRecentlyReviewedPrs(...args); },
  async archived(...args: Parameters<typeof isRepoArchived>) { await defaultProvider("github", "pr.read"); return isRepoArchived(...args); },
  async search(...args: Parameters<typeof searchIssues>) { await defaultProvider("github", "pr.search"); return searchIssues(...args); },
  async state(...args: Parameters<typeof fetchPrState>) { await defaultProvider("github", "pr.read"); return fetchPrState(...args); },
  async organizations() {
    await defaultProvider("github", "pr.search");
    const { stdout } = await execGh(["api", "/user/orgs?per_page=100"]);
    const parsed = JSON.parse(stdout) as Array<{ login?: string }>;
    return parsed.map((o) => o.login).filter((login): login is string => Boolean(login));
  },
};
