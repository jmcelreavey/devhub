import { calendarAuthStart } from "../../../../../../../../packages/shared/actions/calendar";
import { getAuthUrl, googleCalendarOAuthCallbackUrl } from "../../../../../lib/google-calendar";


export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  return await calendarAuthStart.handler({ origin }, { execute: async () => {
    const redirectUri = googleCalendarOAuthCallbackUrl(origin);
    const url = getAuthUrl(redirectUri);
    if (!url) {
      return Response.redirect(
        new URL(`/setup?calendar_error=${encodeURIComponent("missing_credentials")}`, origin), 307,
      );
    }
    return Response.redirect(url, 307);
  } }) as Response;
}
