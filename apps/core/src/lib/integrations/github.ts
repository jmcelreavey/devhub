import { githubRequest } from "./github-transport";
export { githubRequest } from "./github-transport";
import { z } from "zod";
import { prepareGithubWrite, executeGithubWrite } from "./github-write";
import { accountsFor } from "./accounts";
import { IntegrationError, type IntegrationItem, type IntegrationProvider, type IntegrationRef } from "./types";
const IssueSchema = z.object({ number: z.number(), title: z.string(), html_url: z.string().url(), state: z.string(), updated_at: z.string(), draft: z.boolean().optional(), head: z.object({ sha: z.string() }).optional() });
function issuePath(ref: IntegrationRef): { repo: string; number: string } {
  const match = ref.id.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/([1-9][0-9]*)$/);
  if (!match || !["issue", "pr"].includes(ref.kind)) throw new IntegrationError("invalid", "Use owner/repository/number for a GitHub issue or PR.");
  return { repo: match[1], number: match[2] };
}
function item(ref: IntegrationRef, raw: z.infer<typeof IssueSchema>): IntegrationItem {
  return { ref, title: raw.title, url: raw.html_url, revision: raw.updated_at, status: { id: raw.state, label: raw.state }, draft: raw.draft, metadata: { github: { number: raw.number, headSha: raw.head?.sha } } };
}
export const githubProvider: IntegrationProvider = {
  id: "github", apiVersion: 1, label: "GitHub",
  capabilities: ["issue.read", "pr.read", "pr.search", "pr.create", "pr.update", "pr.publish"],
  prepareWrite: prepareGithubWrite,
  executeWrite: executeGithubWrite,
  accounts: () => accountsFor("github"),
  async get(ref, context) {
    const { repo, number } = issuePath(ref);
    return item(ref, IssueSchema.parse(await githubRequest(ref.account, "repos/" + repo + "/" + (ref.kind === "pr" ? "pulls/" : "issues/") + number, context)));
  },

};
