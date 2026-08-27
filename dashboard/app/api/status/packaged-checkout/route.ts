import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getPackagedCheckoutStatus } from "@/lib/desktop/bundle-source";

export const dynamic = "force-dynamic";

/** Pollable probe for the packaged-checkout stale banner (no auth — reports capability only). */
export const GET = withErrorHandler(async () => {
  return NextResponse.json(getPackagedCheckoutStatus());
}, "status/packaged-checkout");
