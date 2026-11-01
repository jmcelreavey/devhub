import { setupGitInstall, setupGitInstallGet } from "../../../../../../../../packages/shared/actions/setup";
import { startMacGitInstall } from "../../../../../lib/setup/git-install";



/** GET must not launch the installer. */
export function GET() {
  return setupGitInstallGet.handler({}, { execute: () =>
    Response.json({ ok: false, error: "Use POST to start the installer." }, { status: 405 }),
  }) as Response;
}

/** Darwin only. Fixed argv, no shell. */
export async function POST() {
  return await setupGitInstall.handler({}, { execute: async () => {
    const result = await startMacGitInstall({ platform: process.platform, method: "POST" });
    return Response.json(result.body, { status: result.status });
  } }) as Response;
}
