import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { openPathInCursor } from "@/lib/cursor-open";
import { checkoutPullRequestBranch, OpenPrCheckoutError } from "@/lib/github/open-pr-checkout";
import { CursorDraftError, createCursorDraft } from "@/lib/notes/cursor-draft";
import { getVaultStorage } from "@/lib/vault/vault-registry";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(),
  notePath: z.string().min(1).optional(),
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const checkout = await checkoutPullRequestBranch({
      repo: parsed.data.repo,
      number: parsed.data.number,
    });

    const additionalPaths: string[] = [];
    let writable = false;
    if (parsed.data.notePath) {
      const storage = getVaultStorage("notes");
      const note = storage.read(parsed.data.notePath);
      if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
      const draft = createCursorDraft(
        checkout.localRepoName,
        parsed.data.notePath,
        note.content,
        storage.root,
      );
      additionalPaths.push(draft.markdownPath);
      writable = draft.writable;
    }

    const error = openPathInCursor(checkout.repoPath, additionalPaths);
    if (error) return NextResponse.json({ error }, { status: 503 });

    return NextResponse.json({
      ok: true,
      localRepoName: checkout.localRepoName,
      branch: checkout.branch,
      stashed: checkout.stashed,
      alreadyOnBranch: checkout.alreadyOnBranch,
      writable,
    });
  } catch (error) {
    if (error instanceof OpenPrCheckoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CursorDraftError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}, "github.prs.open-in-cursor");
