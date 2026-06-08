import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getRepoRoot } from "@/lib/notes-dir";
import { buildSyncPreview } from "@/lib/sync-preview";
import type { SyncPreviewKind } from "@/lib/sync-preview-types";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function parseExclude(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((name) => name.trim())
    .filter((name) => SLUG.test(name));
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  if (kind !== "skill" && kind !== "agent") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const prune = searchParams.get("prune") === "true";
  const preview = buildSyncPreview({
    kind: kind as SyncPreviewKind,
    repoRoot: getRepoRoot(),
    exclude: parseExclude(searchParams.get("exclude")),
    prune,
  });

  return NextResponse.json(preview);
}, "sync preview");
