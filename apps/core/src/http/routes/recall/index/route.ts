import { recallIndexBuild, recallIndexBuildInput, recallIndexStatus } from "../../../../../../../packages/shared/actions/recall";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { countEvents } from "../../../../lib/recall/events";
import { buildIndex, clearIndex, isStale, readManifest } from "../../../../lib/recall/store";
import { RECALL_SOURCE_KINDS, type RecallSourceKind } from "../../../../../../../packages/shared/ui-lib/recall/types";


/** GET — index status for the panel: manifest, staleness, event count. */
export const GET = withErrorHandler(async () => {
  return await recallIndexStatus.handler({}, { execute: async () => {
    const manifest = readManifest();
    return Response.json({
      manifest,
      stale: isStale(),
      events: countEvents(),
      sourceKinds: RECALL_SOURCE_KINDS,
    });
  } }) as Response;
}, "recall.index.get");

const BodySchema = recallIndexBuildInput;

/**
 * POST — rebuild.
 *
 * Guarded with `requireDashboardAuth` rather than the loose same-origin check:
 * a rebuild walks the entire notes tree and writes megabytes, so it is exactly
 * the kind of thing that shouldn't be triggerable by any process on the LAN
 * that can reach port 1337.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema.optional().default({}));
  if (!parsed.ok) return parsed.response;

  return await recallIndexBuild.handler(parsed.data, { execute: async () => {
    if (parsed.data.clear) clearIndex();
    const manifest = buildIndex({ kinds: parsed.data.kinds as RecallSourceKind[] | undefined });

    return Response.json({ ok: true, manifest });
  } }) as Response;
}, "recall.index.post");
