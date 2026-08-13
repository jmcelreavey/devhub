import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { appendEvents, readEvents } from "@/lib/recall/events";
import { invalidateMemo } from "@/lib/recall/store";
import { RECALL_EVENT_KINDS, type RecallEventKind } from "@/lib/recall/types";

export const dynamic = "force-dynamic";

const KindEnum = z.enum(RECALL_EVENT_KINDS as unknown as [string, ...string[]]);

/** GET — the spine, newest first. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  const kindsParam = req.nextUrl.searchParams.get("kinds");
  const kinds = kindsParam
    ? (kindsParam
        .split(",")
        .map((k) => k.trim())
        .filter((k) => (RECALL_EVENT_KINDS as readonly string[]).includes(k)) as RecallEventKind[])
    : undefined;

  const events = readEvents({
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 2000) : 100,
    since,
    kinds,
  });
  return NextResponse.json({ events, total: events.length });
}, "recall.events.get");

const EventSchema = z.object({
  kind: KindEnum,
  title: z.string().min(1).max(500),
  body: z.string().max(20_000).optional(),
  source: z.string().min(1).max(120),
  url: z.string().url().optional(),
  ts: z.string().datetime().optional(),
  id: z.string().min(1).max(200).optional(),
  refs: z
    .array(
      z.object({
        kind: z.enum(["task", "meeting", "pr", "note", "diagram", "calendar", "jira", "repo"]),
        id: z.string().min(1),
        label: z.string().min(1),
        href: z.string().optional(),
      }),
    )
    .optional(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const BodySchema = z.union([EventSchema, z.object({ events: z.array(EventSchema).min(1).max(500) })]);

/**
 * POST — append one event or a batch.
 *
 * Writes to the durable spine, so it takes the real auth guard. Supplying `id`
 * makes a re-emit a no-op, which is what lets a git-scanner or a CI hook run
 * repeatedly without duplicating history.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  const auth = requireDashboardAuth(req);
  if (!auth.ok) return auth.response;

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;

  const inputs = "events" in parsed.data ? parsed.data.events : [parsed.data];
  const written = appendEvents(inputs as Parameters<typeof appendEvents>[0]);

  // New events change the corpus, so the memoised index is now behind. The
  // next query rebuilds from disk rather than serving a set that can't contain
  // what was just written.
  if (written.length > 0) invalidateMemo();

  return NextResponse.json({
    ok: true,
    written: written.length,
    skipped: inputs.length - written.length,
    events: written,
  });
}, "recall.events.post");
