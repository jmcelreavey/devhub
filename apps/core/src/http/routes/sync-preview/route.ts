import { syncPreview } from "../../../../../../packages/shared/actions/misc-ui";
import { withErrorHandler } from "../../../lib/api-utils";
import { getRepoRoot } from "../../../lib/notes/dir";
import { buildSyncPreview } from "../../../lib/sync/preview";
import type { SyncPreviewKind } from "../../../lib/sync/preview-types";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function parseExclude(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((name) => name.trim())
    .filter((name) => SLUG.test(name));
}

export const GET = withErrorHandler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const input = syncPreview.input.parse({
    kind: searchParams.get("kind"),
    prune: searchParams.get("prune") === "true",
    exclude: parseExclude(searchParams.get("exclude")),
  });
  return await syncPreview.handler(input, { execute: previewSync }) as Response;
}, "sync preview");

function previewSync({ kind, prune, exclude }: ReturnType<typeof syncPreview.input.parse>) {
  if (kind !== "skill" && kind !== "agent") {
    return Response.json({ error: "Invalid kind" }, { status: 400 });
  }

  const preview = buildSyncPreview({
    kind: kind as SyncPreviewKind,
    repoRoot: getRepoRoot(),
    exclude,
    prune,
  });

  return Response.json(preview);
}
