/**
 * Browser-driven `gh auth login`, without the terminal.
 *
 * Setup used to say "run `gh auth login` in your terminal, then come back and
 * press Check connection" — which is not onboarding, it is a homework
 * assignment. GitHub's device flow is the same thing `gh auth login --web`
 * does, so DevHub can run it directly: show a code, open GitHub, poll, then
 * hand the resulting token to `gh auth login --with-token` so the CLI (and
 * every DevHub feature that shells out to it) is authenticated for real.
 *
 * The token is never returned to the browser and never written to `.env.local`
 * — it goes straight into `gh`'s own credential store on stdin.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ghEnv } from "@/lib/gh-exec";

/**
 * The GitHub CLI's own public OAuth app. Device flow has no client secret, and
 * using gh's id is what makes the token acceptable to `gh` itself. Overridable
 * for anyone pointing DevHub at their own OAuth app.
 */
const CLIENT_ID = process.env.DEVHUB_GITHUB_OAUTH_CLIENT_ID ?? "178c6fc778ccc68e1d6a";

/**
 * `gh auth login --web` defaults plus `read:packages`. Without packages, Setup
 * re-auth overwrites a working gh token and BI `npm install` 403s on GitHub Packages.
 */
const SCOPES = "repo,read:org,gist,workflow,read:packages";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export interface DeviceLoginStart {
  /** Handle for polling. The device code itself stays on the server. */
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
}

export type DeviceLoginPoll =
  | { status: "pending"; intervalMs: number }
  | { status: "connected"; login: string | null }
  | { status: "expired" }
  | { status: "error"; message: string };

interface PendingLogin {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
}

/**
 * In-memory only, and deliberately so: a device code is a bearer credential for
 * the next 15 minutes. It dies with the process, which is the correct lifetime.
 */
const pending = new Map<string, PendingLogin>();

function sweep(now: number): void {
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(id);
  }
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok && !json.error) throw new Error(`GitHub returned HTTP ${res.status}`);
  return json;
}

export async function startDeviceLogin(): Promise<DeviceLoginStart> {
  const now = Date.now();
  sweep(now);

  const json = await postForm(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: SCOPES });
  const deviceCode = typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  if (!deviceCode || !userCode) {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : "GitHub did not return a device code.",
    );
  }

  const intervalMs = Math.max(Number(json.interval ?? 5), 5) * 1000;
  const expiresAt = now + Math.max(Number(json.expires_in ?? 900), 60) * 1000;
  const id = randomUUID();
  pending.set(id, { deviceCode, intervalMs, expiresAt });

  return {
    id,
    userCode,
    verificationUri:
      typeof json.verification_uri === "string" ? json.verification_uri : "https://github.com/login/device",
    expiresAt,
    intervalMs,
  };
}

export async function pollDeviceLogin(id: string): Promise<DeviceLoginPoll> {
  const now = Date.now();
  sweep(now);
  const entry = pending.get(id);
  if (!entry) return { status: "expired" };

  const json = await postForm(ACCESS_TOKEN_URL, {
    client_id: CLIENT_ID,
    device_code: entry.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });

  const error = typeof json.error === "string" ? json.error : null;
  if (error === "authorization_pending") return { status: "pending", intervalMs: entry.intervalMs };
  if (error === "slow_down") {
    // GitHub tells us the new floor; respect it or it keeps refusing.
    entry.intervalMs = Math.max(Number(json.interval ?? 10), 10) * 1000;
    return { status: "pending", intervalMs: entry.intervalMs };
  }
  if (error === "expired_token" || error === "access_denied") {
    pending.delete(id);
    return error === "expired_token"
      ? { status: "expired" }
      : { status: "error", message: "Authorization was denied on GitHub." };
  }
  if (error) {
    pending.delete(id);
    return {
      status: "error",
      message: typeof json.error_description === "string" ? json.error_description : error,
    };
  }

  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!token) return { status: "pending", intervalMs: entry.intervalMs };

  pending.delete(id);
  await storeTokenInGh(token);
  return { status: "connected", login: await currentGhLogin() };
}

/** Hand the token to `gh` on stdin — it never touches disk on our side. */
async function storeTokenInGh(token: string): Promise<void> {
  await runGh(["auth", "login", "--hostname", "github.com", "--with-token"], token);
  // Without this, git push/pull from DevHub still prompts for credentials.
  await runGh(["auth", "setup-git", "--hostname", "github.com"]).catch(() => undefined);
}

async function currentGhLogin(): Promise<string | null> {
  try {
    const out = await runGh(["api", "user", "--jq", ".login"]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * `execFile` can't feed stdin, and `--with-token` reads only from stdin, so
 * this is the one place that spawns `gh` directly. Same timeout discipline as
 * {@link execExternal}: never unbounded.
 */
function runGh(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { env: ghEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);

    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`GitHub CLI (\`gh\`) could not be run: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `gh ${args[0]} exited with code ${code}`));
    });

    child.stdin.end(stdin ?? "");
  });
}
