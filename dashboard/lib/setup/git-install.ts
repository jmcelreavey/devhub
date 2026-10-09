import { MAC_GIT_INSTALL_FOLLOWUP } from "@/lib/setup/git-availability";

export interface GitInstallResult {
  status: number;
  body: {
    ok: boolean;
    message?: string;
    error?: string;
    alreadyInstalled?: boolean;
  };
}

type Runner = (file: string, args: readonly string[]) => Promise<unknown>;

async function defaultRun(file: string, args: readonly string[]): Promise<unknown> {
  const { execExternal } = await import("@/lib/exec-external");
  return execExternal(file, args, { timeoutMs: 15_000, label: "xcode-select:--install" });
}

/**
 * Start Apple's Command Line Tools installer. Darwin and POST only.
 * The argv is fixed: nothing from the request is interpolated into a shell.
 */
export async function startMacGitInstall(input: {
  platform: NodeJS.Platform;
  method: string;
  run?: Runner;
}): Promise<GitInstallResult> {
  if (input.method !== "POST") {
    return { status: 405, body: { ok: false, error: "Use POST to start the installer." } };
  }
  if (input.platform !== "darwin") {
    return { status: 400, body: { ok: false, error: "Install Git is only available on macOS." } };
  }
  const run = input.run ?? defaultRun;
  try {
    await run("xcode-select", ["--install"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already installed/i.test(message)) {
      return { status: 200, body: { ok: true, alreadyInstalled: true, message: MAC_GIT_INSTALL_FOLLOWUP } };
    }
    return { status: 500, body: { ok: false, error: "Couldn't start the macOS installer." } };
  }
  return { status: 200, body: { ok: true, message: MAC_GIT_INSTALL_FOLLOWUP } };
}
