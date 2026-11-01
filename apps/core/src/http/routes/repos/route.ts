import { reposList } from "../../../../../../packages/shared/actions/repos";
import { formatPathWithTilde, getReposScanDir, listRepos } from "../../../lib/repos/index";
import { httpAction } from "../../../lib/actions/http";

export const GET = httpAction(reposList, {
  input: () => ({}),
  context: () => ({ list: async () => ({
    repos: await listRepos(),
    scanDirDisplay: formatPathWithTilde(getReposScanDir()),
  }) }),
  response: (result) => Response.json(result),
});
