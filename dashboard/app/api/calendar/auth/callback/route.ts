import { NextResponse } from "next/server";
import {
  patchDashboardEnvLocalFile,
  readDashboardEnvLocalFile,
  syncGoogleProcessEnvFromOverrides,
} from "@/lib/dashboard-env-local";
import { exchangeCode, googleCalendarOAuthCallbackUrl } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const origin = reqUrl.origin;
  const code = reqUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL(`/setup?calendar_error=${encodeURIComponent("missing_code")}`, origin),
    );
  }

  const redirectUri = googleCalendarOAuthCallbackUrl(origin);

  try {
    const refreshToken = await exchangeCode(code, redirectUri);
    patchDashboardEnvLocalFile((overrides) => {
      overrides.set("GOOGLE_REFRESH_TOKEN", refreshToken);
      overrides.set("GOOGLE_OAUTH_REDIRECT_URI", redirectUri);
    });
    const { overrides } = readDashboardEnvLocalFile();
    syncGoogleProcessEnvFromOverrides(overrides);

    return NextResponse.redirect(new URL("/setup?calendar_connected=1", origin));
  } catch (e) {
    const message = e instanceof Error ? e.message : "oauth_failed";
    const u = new URL("/setup", origin);
    u.searchParams.set("calendar_error", "oauth_failed");
    u.searchParams.set("calendar_error_detail", message.slice(0, 300));
    return NextResponse.redirect(u);
  }
}
