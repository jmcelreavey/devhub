import { desktopMigrationRead, desktopMigrationRun } from "../../../../../../../packages/shared/actions/desktop";
import { readAppVersion } from "../../../../lib/desktop/app-version";
import { parseBody } from "../../../../lib/api-utils";
import { isAuthenticatedDesktopRequest, isDesktopSession } from "@devhub/core/local/terminal/bootstrap-auth";
import {
  planMigration,
  readMigrationRecord,
  runMigration,
  type MigrationChoice,
} from "../../../../lib/desktop/migration";
import { patchDashboardEnvLocalFile } from "../../../../lib/dashboard-env-local";

/**
 * Migration: `GET` to see the plan, `POST` to run it.
 *
 * Split deliberately. `GET` touches nothing, so the wizard can show real paths
 * and real file counts before the user commits — asking somebody to approve an
 * import of their own notes without telling them where those notes are is not
 * consent, it is a dialog.
 *
 * Desktop-only and authenticated: in browser mode there is no Electron install
 * to migrate and no reason to expose local filesystem paths over HTTP.
 */


function guard(req: Request): Response | null {
  if (!isDesktopSession()) {
    return Response.json({ error: "Not running in the desktop app" }, { status: 404 });
  }
  if (!isAuthenticatedDesktopRequest(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return await desktopMigrationRead.handler({}, { execute: migrationPreview }) as Response;
}

function migrationPreview() {
  const plan = planMigration();
  return Response.json({
    available: plan.install !== null,
    alreadyMigrated: plan.alreadyMigrated,
    previous: readMigrationRecord(),
    install: plan.install,
    paths: plan.paths,
    // Key names only. The values are live credentials and the wizard has no
    // reason to render them.
    configKeys: plan.configKeys,
    unknownLineCount: plan.unknownLineCount,
  });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;

  const parsed = await parseBody(req, desktopMigrationRun.input);
  if (!parsed.ok) return parsed.response;
  return await desktopMigrationRun.handler(parsed.data, { execute: performMigration }) as Response;
}

function performMigration(input: ReturnType<typeof desktopMigrationRun.input.parse>) {
  const plan = planMigration();
  if (!plan.install) {
    return Response.json({ error: "No existing DevHub installation found" }, { status: 404 });
  }

  const result = runMigration({
    plan,
    choices: input.choices as MigrationChoice[],
    appVersion: readAppVersion(),
  });

  if (!result.ok) {
    // The old install is untouched by construction — nothing here deletes or
    // moves anything — so a failure is safe to retry.
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Config is written through the one module that owns .env.local, so file
  // permissions and passthrough handling stay in a single place.
  patchDashboardEnvLocalFile((overrides) => {
    for (const [key, value] of result.envUpdates) overrides.set(key, value);
  });

  return Response.json({
    ok: true,
    record: result.record,
    copied: result.copied,
    quarantineFile: result.quarantineFile ?? null,
    message:
      "Imported. Your previous DevHub installation was left completely untouched — nothing was moved or deleted.",
  });
}
