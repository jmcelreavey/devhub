import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { loadRebuildOffer, startCheckoutRebuild } from "@/lib/desktop/checkout-rebuild";

export const dynamic = "force-dynamic";

/**
 * Rebuild the running app from the linked checkout.
 *
 * GET is unauthenticated on purpose, same as `/api/status/dashboard/rebuild`:
 * the update banner and the status page poll it, including while a restart is
 * in progress. It reports capability and the rebuild log, never a path the
 * caller supplied. POST is origin-guarded by `proxy.ts` and ignores every
 * field except `pull`.
 */
export const GET = withErrorHandler(async () => {
  const offer = await loadRebuildOffer();
  return NextResponse.json({
    available: offer.available,
    mode: offer.mode,
    checkout: offer.checkout,
    checkoutAhead: offer.checkoutAhead,
    reason: offer.reason,
    status: offer.status,
    log: offer.log,
    restartRequired: offer.status?.restartRequired === true,
  });
}, "rebuild");

export const POST = withErrorHandler(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { pull?: unknown } | null;
  const pull = body?.pull === true;
  const offer = await loadRebuildOffer();
  const started = startCheckoutRebuild(offer, pull);
  if (!started.ok) {
    return NextResponse.json({ error: started.error }, { status: started.status });
  }
  return NextResponse.json({
    ok: true,
    started: true,
    mode: offer.mode,
    message: offer.mode === "service"
      ? "Pull and rebuild started. The service keeps the current build until the new one is up."
      : "Pull and rebuild started. DevHub will ask you to restart when the new build is ready.",
  });
}, "rebuild");
