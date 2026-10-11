/**
 * Native screen projections keep existing Jira/PR response shapes while provider
 * selection and capability checks live at the integration boundary.
 * Legacy screens use the default account; the generic screen supports named ones.
 */
import { getMyTickets, getTicket, getJiraMeta } from "@/lib/jira/client";
import { fetchMyGithubPrs, fetchRecentlyReviewedPrs, isRepoArchived, searchIssues } from "@/lib/github/prs";
import { fetchPrState } from "@/lib/github/pr-state";
import { execGh } from "@/lib/gh-exec";
import { providerFor } from "./registry";
import { assertCapability, IntegrationError } from "./types";

function defaultProvider(id: string, capability: string) {
  const provider = providerFor(id);
  assertCapability(provider, capability);
  if (!provider.accounts().some((a) => a.id === "default")) throw new IntegrationError("not-found", "The default integration account is unavailable.");
  return provider;
}
export const jiraScreen = {
  tickets() { defaultProvider("jira", "issue.search"); return getMyTickets(); },
  ticket(...args: Parameters<typeof getTicket>) { defaultProvider("jira", "issue.read"); return getTicket(...args); },
  meta(...args: Parameters<typeof getJiraMeta>) { defaultProvider("jira", "issue.create"); return getJiraMeta(...args); },
  async transitions(key: string) {
    const provider = defaultProvider("jira", "issue.transitions");
    if (!provider.transitions) throw new IntegrationError("unsupported", "Jira transitions are unavailable.");
    const transitions = await provider.transitions({ provider: "jira", account: "default", kind: "issue", id: key }, { signal: AbortSignal.timeout(15000) });
    return transitions.map((t) => ({ id: t.id, name: t.label, to: t.statusLabel ?? t.label }));
  },
};
export const githubScreen = {
  prs() { defaultProvider("github", "pr.search"); return fetchMyGithubPrs(); },
  recentlyReviewed(...args: Parameters<typeof fetchRecentlyReviewedPrs>) { defaultProvider("github", "pr.search"); return fetchRecentlyReviewedPrs(...args); },
  archived(...args: Parameters<typeof isRepoArchived>) { defaultProvider("github", "pr.read"); return isRepoArchived(...args); },
  search(...args: Parameters<typeof searchIssues>) { defaultProvider("github", "pr.search"); return searchIssues(...args); },
  state(...args: Parameters<typeof fetchPrState>) { defaultProvider("github", "pr.read"); return fetchPrState(...args); },
  async organizations() {
    defaultProvider("github", "pr.search");
    const { stdout } = await execGh(["api", "/user/orgs?per_page=100"]);
    const parsed = JSON.parse(stdout) as Array<{ login?: string }>;
    return parsed.map((o) => o.login).filter((login): login is string => Boolean(login));
  },
};
