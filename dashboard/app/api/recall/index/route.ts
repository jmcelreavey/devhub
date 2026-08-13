import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { countEvents } from "@/lib/recall/events";
import { buildIndex, clearIndex, isStale, readManifest } from "@/lib/recall/store";
import { RECALL_SOURCE_KINDS, type RecallSourceKind } from "@/lib/recall/types";

export const dynamic = "force-dynamic";

/** GET — index status for the panel: manifest, staleness, event count. */
export const GET = withErrorHandler(async () => {
  const manifest = readManifest();
  return NextResponse.json({
    manifest,
    stale: isStale(),
    events: countEvents(),
    sourceKinds: RECALL_SOURCE_KINDS,
  });
}, "recall.index.get");

const BodySchema = z.object({
  /** Restrict the rebuild to these source kinds. Omit for everything. */
  kinds: z.array(z.enum(RECALL_SOURCE_KINDS as unknown as [string, ...string[]])).optional(),
  /** Drop the existing index before building. */
  clear: z.boolean().optional(),
});

/**
 * POST — rebuild.
 *
 * Guarded with `requireDashboardAuth` rather than the loose same-origin check:
 * a rebuild walks the entire notes tree and writes megabytes, so it is exactly
 * the kind of thing that shouldn't be triggerable by any process on the LAN
 * that can reach port 1337.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema.optional().default({}));
  if (!parsed.ok) return parsed.response;

  if (parsed.data.clear) clearIndex();
  const manifest = buildIndex({ kinds: parsed.data.kinds as RecallSourceKind[] | undefined });

  return NextResponse.json({ ok: true, manifest });
}, "recall.index.post");
