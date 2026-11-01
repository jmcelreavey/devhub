import { calendarAuthCallback } from "../../../../../../../../packages/shared/actions/calendar";
import {
  patchDashboardEnvLocalFile,
  readDashboardEnvLocalFile,
  syncGoogleProcessEnvFromOverrides,
} from "../../../../../lib/dashboard-env-local";
import { exchangeCode, googleCalendarOAuthCallbackUrl } from "../../../../../lib/google-calendar";


export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const origin = reqUrl.origin;
  const code = reqUrl.searchParams.get("code");


  return await calendarAuthCallback.handler({ origin, code }, { execute: async () => {
    if (!code) {
      return Response.redirect(
        new URL(`/setup?calendar_error=${encodeURIComponent("missing_code")}`, origin), 307,
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

      return Response.redirect(new URL("/setup?calendar_connected=1", origin), 307);
    } catch (e) {
      const message = e instanceof Error ? e.message : "oauth_failed";
      const u = new URL("/setup", origin);
      u.searchParams.set("calendar_error", "oauth_failed");
      u.searchParams.set("calendar_error_detail", message.slice(0, 300));
      return Response.redirect(u, 307);
    }
  } }) as Response;
}
