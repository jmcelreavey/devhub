import { NextResponse } from "next/server";
import { getAuthUrl, googleCalendarOAuthCallbackUrl } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const redirectUri = googleCalendarOAuthCallbackUrl(origin);
  const url = getAuthUrl(redirectUri);
  if (!url) {
    return NextResponse.json(
      { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local or save them from /setup" },
      { status: 400 },
    );
  }
  return NextResponse.json({ url });
}
