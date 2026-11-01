import os from "node:os";
import { setupPrivateRepoRead, setupPrivateRepoWrite } from "../../../../../../../packages/shared/actions/setup";
import { parseBody, requireDashboardAuth } from "../../../../lib/api-utils";
import { getCheckoutRoot, isDesktopRuntime } from "../../../../lib/desktop/runtime-paths";
import { readDashboardEnvLocalFile } from "../../../../lib/dashboard-env-local";
import { PrivateRepoSetupSchema, setupPrivateRepo, assertPrivateRepo, suggestedPrivateRepoDirectory, describePrivateRepoTarget } from "../../../../lib/setup/private-repo";



export async function GET(req: Request) {
  const denied = requireDashboardAuth(req);
  if (!denied.ok) return denied.response;
  return await setupPrivateRepoRead.handler({}, { execute: readPrivateRepo }) as Response;
}

async function readPrivateRepo() {
  if (!isDesktopRuntime()) return Response.json({ error: "Desktop app required." }, { status: 400 });
  const directory = getCheckoutRoot();
  if (!directory) {
    return Response.json({ ...await describePrivateRepoTarget(suggestedPrivateRepoDirectory(os.homedir())), linked: false });
  }
  try {
    const url = await assertPrivateRepo(directory);
    const { overrides } = readDashboardEnvLocalFile();
    return Response.json({ directory, url, existing: true, linked: overrides.get("DEVHUB_CONTENT_ROOT") === directory });
  } catch (err) {
    return Response.json({ directory, existing: true, linked: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: Request) {
  const denied = requireDashboardAuth(req);
  if (!denied.ok) return denied.response;
  const body = await parseBody(req, PrivateRepoSetupSchema);
  if (!body.ok) return body.response;
  return await setupPrivateRepoWrite.handler({ body: body.data }, {
    execute: ({ body: input }) => writePrivateRepo(input as typeof body.data),
  }) as Response;
}

async function writePrivateRepo(input: ReturnType<typeof PrivateRepoSetupSchema.parse>) {
  try {
    return Response.json({ ...await setupPrivateRepo(input), restartRequired: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
