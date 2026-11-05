import path from "node:path";
import { reposList } from "../../../../../../packages/shared/actions/repos";
import { formatPathWithTilde, getReposScanDir, listRepos } from "../../../lib/repos/index";
import { httpAction } from "../../../lib/actions/http";
import { getRepoRoot } from "../../../lib/notes/dir";

export const GET = httpAction(reposList, {
  input: () => ({}),
  context: () => ({ list: async () => ({
    repos: await listRepos(),
    scanDirDisplay: formatPathWithTilde(getReposScanDir()),
    protectedRepoName: path.basename(getRepoRoot()),
  }) }),
  response: (result) => Response.json(result),
});
