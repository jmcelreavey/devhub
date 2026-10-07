import { NextRequest, NextResponse } from "next/server";
import { parseBody, withErrorHandler } from "@/lib/api-utils";
import { hasCheckout, isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { shouldRemindContentRepo } from "@/lib/setup/content-repo-reminder";
import { detectElectronInstall, readMigrationRecord } from "@/lib/desktop/migration";
import { readSetupProgress, saveSetupProgress } from "@/lib/setup/first-run";
import { SaveSetupProgressSchema } from "@/lib/setup/progress";

export const dynamic = "force-dynamic";

export const GET = withErrorHandler(async () => {
  const state = readSetupProgress();
  return NextResponse.json({
    ...state,
    desktop: isDesktopRuntime(),
    migrationAvailable: isDesktopRuntime() && !state.completed && detectElectronInstall() !== null,
    migrated: readMigrationRecord() !== null,
    contentRepoReminder: shouldRemindContentRepo({ desktop: isDesktopRuntime(), completed: state.completed, dismissed: state.contentRepoReminderDismissed, linked: hasCheckout() }),
  });
});

export const POST = withErrorHandler(async (req: NextRequest) => {
  const parsed = await parseBody(req, SaveSetupProgressSchema);
  if (!parsed.ok) return parsed.response;
  return NextResponse.json({ ok: true, ...saveSetupProgress(parsed.data) });
});
