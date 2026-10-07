import path from "node:path";

export interface CoreDefaultsInput {
  /** Installed desktop app (`DEVHUB_DESKTOP=1`). */
  desktop: boolean;
  /** A real DevHub git checkout, when one is configured or linked. */
  checkoutRoot: string | null;
  /** `REPO_ROOT` from the environment or `.env.local`, if set. */
  configuredRepoRoot?: string;
  /** The server's working directory (`<repo>/dashboard` in a checkout). */
  cwd: string;
  /** Writable application data (`DEVHUB_APP_DATA`). */
  appDataDir: string;
}

export interface CoreDefaults {
  repoRoot: string;
  notesDir: string;
}

/**
 * Suggested values for setup's paths step.
 *
 * In a checkout the server runs from `<repo>/dashboard`, so the repo and its
 * `notes/` are the natural suggestions. The installed app runs from inside
 * its own bundle — `runtime/<payload-id>/server` in WSL, `DevHub.app/…/server`
 * on macOS — and the same arithmetic then suggests storing notes *inside the
 * versioned payload*, which the next update deletes. Setup also pre-fills the
 * hidden checkout field with that suggestion, so saving the paths step wrote
 * a bogus `REPO_ROOT` pointing at the bundle.
 *
 * Without a checkout the desktop app therefore suggests app data for notes and
 * nothing for the checkout.
 */
export function setupCoreDefaults(input: CoreDefaultsInput): CoreDefaults {
  if (input.desktop && !input.checkoutRoot) {
    return { repoRoot: "", notesDir: path.join(input.appDataDir, "notes") };
  }
  const detectedRepo =
    input.configuredRepoRoot ??
    (input.desktop ? input.checkoutRoot : null) ??
    path.resolve(input.cwd, "..");
  return {
    repoRoot: path.dirname(detectedRepo),
    notesDir: path.join(detectedRepo, "notes"),
  };
}
