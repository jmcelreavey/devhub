import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAuth, isSameOriginStrict, parseBody } from "@/lib/api-utils";
import { getTaskProfileOverview } from "@/lib/tasks/profiles";
import { WriteInputSchema } from "@/lib/integrations/write-types";
import { writeNow } from "@/lib/integrations/write-store";
import { directOutcome, integrationFailure } from "@/lib/integrations/write-api";

export async function POST(req: NextRequest) {
  const auth = requireDashboardAuth(req); if (!auth.ok) return auth.response;
  if (!isSameOriginStrict(req)) return NextResponse.json({ error: "Use a same-origin request." }, { status: 403 });
  const parsed = await parseBody(req, WriteInputSchema); if (!parsed.ok) return parsed.response;
  try {
    return directOutcome(await writeNow(parsed.data, getTaskProfileOverview().active ?? "default", req.signal), {});
  } catch (error) { return integrationFailure(error); }
}
