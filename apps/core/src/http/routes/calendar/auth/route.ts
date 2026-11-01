import { calendarAuthUrl } from "../../../../../../../packages/shared/actions/calendar";
import { getAuthUrl, googleCalendarOAuthCallbackUrl } from "../../../../lib/google-calendar";


export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  return await calendarAuthUrl.handler({ origin }, { execute: async () => {
    const redirectUri = googleCalendarOAuthCallbackUrl(origin);
    const url = getAuthUrl(redirectUri);
    if (!url) {
      return Response.json(
        { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local or save them from /setup" },
        { status: 400 },
      );
    }
    return Response.json({ url });
  } }) as Response;
}
