import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { parseBody, requireDashboardAuth } from "@/lib/api-utils";
import { getCheckoutRoot, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { readDashboardEnvLocalFile } from "@/lib/dashboard-env-local";
import { PrivateRepoSetupSchema, setupPrivateRepo, assertPrivateRepo } from "@/lib/setup/private-repo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireDashboardAuth(req);
  if (!denied.ok) return denied.response;
  if (!isDesktopRuntime()) return NextResponse.json({ error: "Desktop app required." }, { status: 400 });
  const directory = getCheckoutRoot();
  if (!directory) {
    const suggested = path.join(os.homedir(), "Developer", "devhub-private");
    return NextResponse.json({ directory: suggested, existing: fs.existsSync(path.join(suggested, ".git")), linked: false });
  }
  try {
    const url = await assertPrivateRepo(directory);
    const { overrides } = readDashboardEnvLocalFile();
    return NextResponse.json({ directory, url, existing: true, linked: overrides.get("DEVHUB_CONTENT_ROOT") === directory });
  } catch (err) {
    return NextResponse.json({ directory, existing: true, linked: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireDashboardAuth(req);
  if (!denied.ok) return denied.response;
  const body = await parseBody(req, PrivateRepoSetupSchema);
  if (!body.ok) return body.response;
  try {
    return NextResponse.json({ ...await setupPrivateRepo(body.data), restartRequired: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
