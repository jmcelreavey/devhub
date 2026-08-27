import { NextResponse, type NextRequest } from "next/server";
import { parseBody } from "@/lib/api-utils";
import { checkJiraConnection } from "@/lib/jira/check";
import { JiraCheckSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Validate the saved env config (no form values). */
export async function GET() {
  return NextResponse.json(await checkJiraConnection({}));
}

/**
 * Validate the credentials currently entered in the setup form, before they're
 * saved. Masked/untouched secrets are omitted and fall back to the saved env.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, JiraCheckSchema);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(
    await checkJiraConnection({
      domain: parsed.data.domain,
      email: parsed.data.email,
      apiToken: parsed.data.apiToken,
    }),
  );
}
