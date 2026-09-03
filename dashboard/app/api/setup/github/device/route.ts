import { NextResponse, type NextRequest } from "next/server";
import { parseBody } from "@/lib/api-utils";
import { GithubDeviceLoginSchema } from "@/lib/schemas";
import { pollDeviceLogin, startDeviceLogin } from "@/lib/github/device-login";

export const dynamic = "force-dynamic";

/**
 * GitHub device-flow login, driven from the setup wizard.
 *
 * `start` asks GitHub for a code to show the user; `poll` checks whether they
 * approved it yet and, once they have, stores the token in `gh`. The access
 * token is never sent to the browser.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, GithubDeviceLoginSchema);
  if (!parsed.ok) return parsed.response;

  try {
    if (parsed.data.action === "start") {
      return NextResponse.json(await startDeviceLogin());
    }
    return NextResponse.json(await pollDeviceLogin(parsed.data.id));
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "GitHub sign-in failed." },
      { status: 500 },
    );
  }
}
