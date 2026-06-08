import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { getRepoRoot } from "@/lib/notes-dir";
import { collectSyncHealth } from "@/lib/sync-health";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  return NextResponse.json(await collectSyncHealth(getRepoRoot()));
}, "sync health");
