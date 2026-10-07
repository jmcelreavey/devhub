import { NextResponse, type NextRequest } from "next/server";
import { requireDashboardAuth, withErrorHandler } from "@/lib/api-utils";
import { VoiceError } from "@/lib/voice/train";

/**
 * Every voice route reads or rewrites how agents write as the user, so all of
 * them need dashboard auth. Expected failures (`VoiceError`) keep their status;
 * anything else falls through to the generic 500.
 */
export function voiceRoute(label: string, handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: NextRequest) => {
    const auth = requireDashboardAuth(req);
    if (!auth.ok) return auth.response;
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof VoiceError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  }, `voice:${label}`);
}
