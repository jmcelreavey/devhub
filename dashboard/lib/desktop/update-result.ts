/**
 * What a manual "Check for Updates" tells the user. Mirrors `CheckOutcome` in
 * desktop/src-tauri/src/updater.rs: the shell classifies, this decides the words.
 *
 * Every outcome produces a notice, because a check that ends in silence reads as
 * a menu item that does nothing.
 */
export type CheckOutcome =
  | { status: "upToDate"; currentVersion: string }
  | { status: "available"; currentVersion: string; version: string; notes?: string | null; date?: string | null }
  | { status: "noRelease"; currentVersion: string }
  | { status: "failed"; currentVersion: string; message: string; details: string };

/** The slice of GET /api/rebuild the notice needs. */
export interface CheckoutRebuildHint {
  /** Rebuild from the linked checkout can run here. */
  available: boolean;
  /** The linked checkout has commits the running build does not. */
  checkoutAhead: boolean;
}

export type NoticeAction = "install" | "rebuild" | "retry";

export interface UpdateNotice {
  tone: "info" | "success" | "warning";
  title: string;
  body?: string;
  /** Raw text behind a Details control, for failures. */
  details?: string;
  actions: NoticeAction[];
}

export const CHECKING_NOTICE: UpdateNotice = { tone: "info", title: "Checking for updates…", actions: [] };

export function describeCheck(outcome: CheckOutcome, rebuild?: CheckoutRebuildHint | null): UpdateNotice {
  const canRebuild = Boolean(rebuild?.available && rebuild.checkoutAhead);
  // The user's own checkout is a second source of "newer": say so beside a
  // release result, instead of leaving them to find it in Tools.
  const rebuildNote = canRebuild ? " Your checkout is ahead of the running build." : "";
  const rebuildAction: NoticeAction[] = canRebuild ? ["rebuild"] : [];
  switch (outcome.status) {
    case "upToDate":
      return {
        tone: "success",
        title: `You're up to date (${outcome.currentVersion})`,
        body: rebuildNote.trim() || undefined,
        actions: rebuildAction,
      };
    case "available":
      return {
        tone: "info",
        title: `DevHub ${outcome.version} is available`,
        body: `You're on ${outcome.currentVersion}.${rebuildNote}`,
        actions: ["install", ...rebuildAction],
      };
    case "noRelease":
      return {
        tone: "info",
        title: "No published release yet",
        body: `You're on ${outcome.currentVersion}, the latest build there is.${rebuildNote}`,
        actions: rebuildAction,
      };
    case "failed":
      return {
        tone: "warning",
        title: outcome.message,
        details: outcome.details,
        actions: ["retry", ...rebuildAction],
      };
  }
}
