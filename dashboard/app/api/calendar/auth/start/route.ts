import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl, googleCalendarOAuthCallbackUrl } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const redirectUri = googleCalendarOAuthCallbackUrl(origin);
  const url = getAuthUrl(redirectUri);
  if (!url) {
    return NextResponse.redirect(
      new URL(`/setup?calendar_error=${encodeURIComponent("missing_credentials")}`, origin),
    );
  }
  return NextResponse.redirect(url);
}
