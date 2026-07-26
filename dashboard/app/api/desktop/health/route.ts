import { NextRequest, NextResponse } from "next/server";
import { isAuthenticatedDesktopRequest, isDesktopSession } from "@/lib/desktop/bootstrap-auth";
import { getAppDataDir, getResourceRoot } from "@/lib/desktop/runtime-paths";

/**
 * "Is DevHub up, and is it *this* DevHub?"
 *
 * The shell polls this before it will show the dashboard. It is authenticated
 * for one reason: something answering on port 1337 is not evidence that DevHub
 * is answering on port 1337. Without the token, a stale server, a colleague's
 * instance, or a deliberately planted local service would all be adopted as the
 * app's own backend — and the shell would hand them a window.
 *
 * It also intentionally does not report anything a caller could not already
 * work out. Paths are useful in a bug report and are only returned once the
 * request has proven it is the shell.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDesktopSession()) {
    return NextResponse.json(
      { devhub: true, desktop: false, status: "browser" },
      { status: 200 },
    );
  }

  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    devhub: true,
    desktop: true,
    status: "ready",
    version: process.env.DEVHUB_VERSION ?? null,
    appData: getAppDataDir(),
    resourceRoot: getResourceRoot(),
    pid: process.pid,
  });
}
