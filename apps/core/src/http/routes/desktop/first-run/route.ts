import { parseBody, withErrorHandler } from "../../../../lib/api-utils";
import { desktopFirstRunRead, desktopFirstRunSave } from "../../../../../../../packages/shared/actions/desktop";
import { hasCheckout, isDesktopRuntime } from "../../../../lib/desktop/runtime-paths";
import { shouldRemindContentRepo } from "../../../../lib/setup/content-repo-reminder";
import { detectElectronInstall, readMigrationRecord } from "../../../../lib/desktop/migration";
import { readSetupProgress, saveSetupProgress } from "../../../../lib/setup/first-run";
import { SaveSetupProgressSchema } from "../../../../../../../packages/shared/ui-lib/setup/progress";
import { configuredJiraDomain } from "../../../../lib/jira/env";



export const GET = withErrorHandler(async () => {
  return await desktopFirstRunRead.handler({}, { execute: readFirstRun }) as Response;
});

function readFirstRun() {
  const state = readSetupProgress();
  return Response.json({
    ...state,
    desktop: isDesktopRuntime(),
    jiraDomain: configuredJiraDomain(),
    migrationAvailable: isDesktopRuntime() && !state.completed && detectElectronInstall() !== null,
    migrated: readMigrationRecord() !== null,
    contentRepoReminder: shouldRemindContentRepo({ desktop: isDesktopRuntime(), completed: state.completed, dismissed: state.contentRepoReminderDismissed, linked: hasCheckout() }),
  });
}

export const POST = withErrorHandler(async (req: Request) => {
  const parsed = await parseBody(req, SaveSetupProgressSchema);
  if (!parsed.ok) return parsed.response;
  return await desktopFirstRunSave.handler({ body: parsed.data }, {
    execute: ({ body }) => Response.json({ ok: true, ...saveSetupProgress(body as typeof parsed.data) }),
  }) as Response;
});
