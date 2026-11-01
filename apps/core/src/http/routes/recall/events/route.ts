import { recallRemember, recallEventsAppend, recallEventsBodyInput, recallEventsRead } from "../../../../../../../packages/shared/actions/recall";
import { parseBody, requireDashboardAuth, withErrorHandler } from "../../../../lib/api-utils";
import { appendEvents, readEvents } from "../../../../lib/recall/events";
import { invalidateMemo } from "../../../../lib/recall/store";
import { RECALL_EVENT_KINDS, type RecallEventKind } from "../../../../../../../packages/shared/ui-lib/recall/types";


/** GET — the spine, newest first. */
export const GET = withErrorHandler(async (req: Request) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  const since = new URL(req.url).searchParams.get("since") ?? undefined;
  const kindsParam = new URL(req.url).searchParams.get("kinds");
  const kinds = kindsParam
    ? (kindsParam
        .split(",")
        .map((k) => k.trim())
        .filter((k) => (RECALL_EVENT_KINDS as readonly string[]).includes(k)) as RecallEventKind[])
    : undefined;

  const input = {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 2000) : 100,
    since,
    kinds,
  };
  const events = await recallEventsRead.handler(input, { execute: () => readEvents(input) }) as ReturnType<typeof readEvents>;
  return Response.json({ events, total: events.length });
}, "recall.events.get");

const BodySchema = recallEventsBodyInput;

/**
 * POST — append one event or a batch.
 *
 * Writes to the durable spine, so it takes the real auth guard. Supplying `id`
 * makes a re-emit a no-op, which is what lets a git-scanner or a CI hook run
 * repeatedly without duplicating history.
 */
export const POST = withErrorHandler(async (req: Request) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const inputs = "events" in parsed.data ? parsed.data.events : [parsed.data];
  const execute = () => appendEvents(inputs as Parameters<typeof appendEvents>[0]);
  const written = await ("events" in parsed.data
    ? recallEventsAppend.handler({ events: inputs }, { execute })
    : recallRemember.handler(parsed.data, { execute })) as ReturnType<typeof appendEvents>;

  // Drop the in-memory index only. That is not a rebuild — the next query's
  // loadIndex() sees a newer spine via isStale() and rebuilds from sources.
  if (written.length > 0) invalidateMemo();

  return Response.json({
    ok: true,
    written: written.length,
    skipped: inputs.length - written.length,
    events: written,
  });
}, "recall.events.post");
