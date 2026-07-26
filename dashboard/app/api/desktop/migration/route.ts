import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { isAuthenticatedDesktopRequest, isDesktopSession } from "@/lib/desktop/bootstrap-auth";
import {
  planMigration,
  readMigrationRecord,
  runMigration,
  type MigrationChoice,
} from "@/lib/desktop/migration";
import { patchDashboardEnvLocalFile } from "@/lib/dashboard-env-local";

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
export const dynamic = "force-dynamic";

function guard(req: NextRequest): NextResponse | null {
  if (!isDesktopSession()) {
    return NextResponse.json({ error: "Not running in the desktop app" }, { status: 404 });
  }
  if (!isAuthenticatedDesktopRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;

  const plan = planMigration();
  return NextResponse.json({
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

const MigrateSchema = z.object({
  choices: z
    .array(
      z.object({
        key: z.string().max(64),
        action: z.enum(["keep", "copy", "skip"]),
      }),
    )
    .max(32),
});

export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;

  const parsed = await parseBody(req, MigrateSchema);
  if (!parsed.ok) return parsed.response;

  const plan = planMigration();
  if (!plan.install) {
    return NextResponse.json({ error: "No existing DevHub installation found" }, { status: 404 });
  }

  const result = runMigration({
    plan,
    choices: parsed.data.choices as MigrationChoice[],
    appVersion: process.env.DEVHUB_VERSION ?? "unknown",
  });

  if (!result.ok) {
    // The old install is untouched by construction — nothing here deletes or
    // moves anything — so a failure is safe to retry.
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  // Config is written through the one module that owns .env.local, so file
  // permissions and passthrough handling stay in a single place.
  patchDashboardEnvLocalFile((overrides) => {
    for (const [key, value] of result.envUpdates) overrides.set(key, value);
  });

  return NextResponse.json({
    ok: true,
    record: result.record,
    copied: result.copied,
    quarantineFile: result.quarantineFile ?? null,
    message:
      "Imported. Your previous DevHub installation was left completely untouched — nothing was moved or deleted.",
  });
}
