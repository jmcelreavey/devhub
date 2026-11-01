import { parseBody } from "../../../../lib/api-utils";
import { coreGitConflicts, coreGitResolveConflict, coreGitResolveConflictInput } from "../../../../../../../packages/shared/actions/repos";
import { httpAction } from "../../../../lib/actions/http";
import { withErrorHandler } from "../../../../lib/api-utils";
import {
  detectGitConflictsAsync,
  readConflictFileContent,
  resolveConflictFile,
} from "../../../../lib/git/conflicts";
import { getRepoRoot } from "../../../../lib/notes/dir";


export const GET = withErrorHandler(async (req: Request) => httpAction(coreGitConflicts, {
  input: () => ({}),
  context: () => ({ read: readConflicts }),
  response: (result) => Response.json(result.body, { status: result.status }),
})(req), "git conflicts");

async function readConflicts() {
  const repoRoot = getRepoRoot();
  const conflicts = await detectGitConflictsAsync(repoRoot);
  return { status: 200, body: {
    conflicts: conflicts.map((c) => ({
      ...c,
      content: readConflictFileContent(repoRoot, c.path),
    })),
    count: conflicts.length,
  } };
}

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, coreGitResolveConflictInput);
  if (!parsed.ok) return parsed.response;
  return httpAction(coreGitResolveConflict, {
    input: () => parsed.data,
    context: () => ({ resolve: async ({ path, content, expectedContent }) => {
      const result = await resolveConflictFile(getRepoRoot(), path, content, expectedContent);
      if (!result.ok) return { status: result.code === "content_changed" ? 409 : 400, body: { error: result.error } };
      const remaining = await detectGitConflictsAsync(getRepoRoot());
      return { status: 200, body: { ok: true, remaining: remaining.length } };
    } }),
    response: (result) => Response.json(result.body, { status: result.status }),
  })(req);
}, "git conflicts resolve");
