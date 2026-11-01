import { z } from "zod";
import { prOpen, prOpenInput } from "../../../../../../../../packages/shared/actions/work";
import { httpAction } from "../../../../../lib/actions/http";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../../lib/api-utils";
import { openPathInCursor } from "../../../../../lib/editor/cursor-open";
import { checkoutPullRequestBranch, OpenPrCheckoutError } from "../../../../../lib/github/open-pr-checkout";
import { CursorDraftError, createCursorDraft } from "../../../../../lib/notes/cursor-draft";
import { getVaultStorage } from "../../../../../lib/vault/vault-registry";


const BodySchema = prOpenInput.omit({ confirm: true }).extend({
  repo: prOpenInput.shape.repo.min(1),
  number: z.coerce.number().int().positive(),
  notePath: prOpenInput.shape.notePath.unwrap().min(1).optional(),
});

export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  return httpAction(prOpen, {
    input: () => ({ ...parsed.data, confirm: true }),
    context: () => ({ open: async () => {
      const response = await openPullRequest(parsed.data);
      return { status: response.status, body: await response.json() };
    } }),
    response: (result) => result.kind === "opened"
      ? Response.json(result.response.body, { status: result.response.status })
      : Response.json({ error: "Confirmation required" }, { status: 400 }),
  })(req);
}, "github.prs.open-in-cursor");

async function openPullRequest(input: z.output<typeof BodySchema>) {
  try {
    const checkout = await checkoutPullRequestBranch({
      repo: input.repo,
      number: input.number,
    });

    const additionalPaths: string[] = [];
    let writable = false;
    if (input.notePath) {
      const storage = getVaultStorage("notes");
      const note = storage.read(input.notePath);
      if (!note) return Response.json({ error: "Note not found" }, { status: 404 });
      const draft = createCursorDraft(
        checkout.localRepoName,
        input.notePath,
        note.content,
        storage.root,
      );
      additionalPaths.push(draft.markdownPath);
      writable = draft.writable;
    }

    const error = await openPathInCursor(checkout.repoPath, additionalPaths);
    if (error) return Response.json({ error }, { status: 503 });

    return Response.json({
      ok: true,
      localRepoName: checkout.localRepoName,
      branch: checkout.branch,
      stashed: checkout.stashed,
      alreadyOnBranch: checkout.alreadyOnBranch,
      writable,
    });
  } catch (error) {
    if (error instanceof OpenPrCheckoutError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CursorDraftError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
