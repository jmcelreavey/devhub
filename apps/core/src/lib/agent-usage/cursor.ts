import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execExternal } from "../exec-external";
import { UsageLoadError } from "./load-error";
import type { ProviderUsage } from "./types";

// Cursor encrypts its desktop tokens before writing them to SQLite. The
// decrypted token authenticates its IDE dashboard RPCs, which are undocumented.
const CURSOR_SAFE_STORAGE_PREFIX = "cursor-safe-storage:v1:";
const CURSOR_RPC_ORIGIN = "https://api2.cursor.sh/aiserver.v1.DashboardService";

export async function stateDbPath(): Promise<string | null> {
  const home = os.homedir();
  if (process.env.WSL_DISTRO_NAME) {
    // The editor runs on Windows; signing in to the WSL agent CLI does not
    // populate its separate subscription database.
    try {
      const appData = (await execExternal("cmd.exe", ["/d", "/c", "echo", "%APPDATA%"], { timeoutMs: 3_000, label: "usage:cursor-windows-profile" })).stdout.trim();
      if (!/^[A-Za-z]:\\/.test(appData)) return null;
      const converted = (await execExternal("wslpath", ["-u", appData], { timeoutMs: 3_000, label: "usage:cursor-windows-path" })).stdout.trim();
      return converted.startsWith("/") ? path.join(converted, "Cursor", "User", "globalStorage", "state.vscdb") : null;
    } catch { return null; }
  }
  if (process.platform === "win32") return process.env.APPDATA ? path.join(process.env.APPDATA, "Cursor", "User", "globalStorage", "state.vscdb") : null;
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Cursor", "User", "globalStorage", "state.vscdb");
}

const periodUsageSchema = z.object({
  billingCycleEnd: z.string().optional(),
  planUsage: z.object({
    autoPercentUsed: z.number().optional(),
    apiPercentUsed: z.number().optional(),
    totalPercentUsed: z.number(),
  }),
});

const planInfoSchema = z.object({ planInfo: z.object({ planName: z.string() }).optional(), isMerged: z.boolean().optional() });

const weeklyUsageSchema = z.object({
  isUnified: z.boolean().optional(),
  usagePercent: z.number().finite().nonnegative(),
  nextResetTimestampUtc: z.string().optional(),
  hasNonZeroIncludedLimit: z.boolean().optional(),
  cursorPlanName: z.string().optional(),
});

export function decryptCursorSafeStorage(stored: string, password: string): string {
  if (!stored.startsWith(CURSOR_SAFE_STORAGE_PREFIX)) throw new UsageLoadError("Invalid Cursor token storage", "Cursor's encrypted sign-in has an unexpected format.");
  const encrypted = Buffer.from(stored.slice(CURSOR_SAFE_STORAGE_PREFIX.length), "base64");
  if (encrypted.subarray(0, 3).toString() !== "v10" || encrypted.length <= 3 || (encrypted.length - 3) % 16 !== 0) {
    throw new UsageLoadError("Invalid Cursor token storage", "Cursor's encrypted sign-in has an unexpected format.");
  }
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString("utf8");
  } catch {
    throw new UsageLoadError("Could not decrypt Cursor token", "macOS Keychain could not unlock Cursor's sign-in.");
  } finally {
    key.fill(0);
  }
}

async function decodeStoredToken(stored: string): Promise<string> {
  if (stored.startsWith("cursor-safe-storage:") && !stored.startsWith(CURSOR_SAFE_STORAGE_PREFIX)) {
    throw new UsageLoadError("Unsupported Cursor token storage", "Cursor changed its encrypted sign-in format.");
  }
  if (!stored.startsWith(CURSOR_SAFE_STORAGE_PREFIX)) return stored;
  if (process.platform !== "darwin") throw new UsageLoadError("Unsupported Cursor token storage", "Cursor's encrypted sign-in is not supported on this operating system yet.");
  let password: string;
  try {
    password = (await execExternal("security", ["find-generic-password", "-s", "Cursor Safe Storage", "-w"], { timeoutMs: 15_000, label: "usage:cursor-keychain" })).stdout.trim();
  } catch {
    throw new UsageLoadError("Could not unlock Cursor token", "Allow macOS Keychain access to Cursor Safe Storage, then retry.");
  }
  if (!password) throw new UsageLoadError("Could not unlock Cursor token", "Cursor Safe Storage is empty in macOS Keychain.");
  return decryptCursorSafeStorage(stored, password);
}

async function readAccessToken(): Promise<string | null> {
  const db = await stateDbPath();
  if (!db || !fs.existsSync(db)) return null;
  // sqlite3 in a subprocess rather than node:sqlite: the file is multi-GB and a
  // synchronous read on the main thread would stall every route while it runs.
  const query = "select value from ItemTable where key = 'cursorAuth/accessToken'";
  const run = (target: string) => execExternal("sqlite3", ["-readonly", target, query], { timeoutMs: 10_000, label: "usage:cursor-token" });
  try {
    const stored = (await run(db)).stdout.trim();
    return stored ? decodeStoredToken(stored) : null;
  } catch {
    // A WAL-mode database with no -wal/-shm files (Cursor closed) can't be opened
    // read-only: SQLite wants to create them. With Cursor closed there is no WAL
    // to miss, so an immutable open reads the main file safely.
    const uri = `${pathToFileURL(db).href}?immutable=1`;
    const stored = (await run(uri)).stdout.trim();
    return stored ? decodeStoredToken(stored) : null;
  }
}

async function cursorRpc(endpoint: string, token: string): Promise<unknown> {
  const response = await fetch(`${CURSOR_RPC_ORIGIN}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Connect-Protocol-Version": "1", "x-cursor-client-type": "ide" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new UsageLoadError(`Cursor ${endpoint} failed (HTTP ${response.status}).`, response.status === 401 ? "Cursor rejected its saved sign-in. Open Cursor to refresh it, then retry." : `Cursor's usage service returned HTTP ${response.status}.`);
  return response.json();
}

export async function loadCursorUsage(): Promise<ProviderUsage> {
  const base = { id: "cursor", name: "Cursor", meters: [], spend: [] } satisfies Partial<ProviderUsage>;
  const token = await readAccessToken();
  if (!token) return { ...base, status: "unavailable", summary: process.env.WSL_DISTRO_NAME ? "Sign in to the Windows Cursor app" : "Sign in to the Cursor app", message: process.env.WSL_DISTRO_NAME
    ? "Sign in to the Windows Cursor desktop app to see plan usage. The WSL agent CLI has a separate sign-in: `agent login`. If the Windows profile is unavailable from WSL, check usage at cursor.com/dashboard."
    : "Sign in to the Cursor desktop app to see plan usage. The agent CLI has a separate sign-in: `agent login`." };

  const [weeklyResult, planResult] = await Promise.allSettled([
    cursorRpc("GetSandUsageStatus", token),
    cursorRpc("GetPlanInfo", token),
  ]);
  const weekly = weeklyResult.status === "fulfilled" ? weeklyUsageSchema.safeParse(weeklyResult.value) : null;
  const parsedPlan = planResult.status === "fulfilled" ? planInfoSchema.safeParse(planResult.value) : null;
  const plan = parsedPlan?.success ? parsedPlan.data : null;
  if (weekly?.success && weekly.data.isUnified) {
    const { usagePercent, nextResetTimestampUtc, cursorPlanName, hasNonZeroIncludedLimit } = weekly.data;
    if (hasNonZeroIncludedLimit === false) return { ...base, plan: cursorPlanName, status: "unavailable", summary: "No included weekly usage is available for this Cursor account.", retryable: false };
    const resetTime = nextResetTimestampUtc ? Date.parse(nextResetTimestampUtc) : NaN;
    return {
      ...base,
      plan: cursorPlanName ?? plan?.planInfo?.planName,
      status: "ok",
      meters: [{ label: "Weekly included usage", percent: usagePercent, resetsAt: Number.isFinite(resetTime) ? new Date(resetTime).toISOString() : undefined }],
    };
  }
  if (plan?.isMerged) {
    if (weeklyResult.status === "rejected") throw weeklyResult.reason;
    throw new UsageLoadError("Could not read Cursor's weekly usage", "Cursor returned an unexpected weekly usage response for this X Subscription.");
  }
  if (planResult.status === "rejected") throw planResult.reason;
  if (parsedPlan?.success === false) throw new UsageLoadError("Could not read Cursor's plan", "Cursor returned an unexpected plan response.");
  const periodRaw = await cursorRpc("GetCurrentPeriodUsage", token);
  const period = periodUsageSchema.parse(periodRaw);
  const resetTime = period.billingCycleEnd ? Number(period.billingCycleEnd) : NaN;
  const resetsAt = Number.isFinite(resetTime) ? new Date(resetTime).toISOString() : undefined;
  const { planUsage } = period;

  return {
    ...base,
    plan: plan?.planInfo?.planName,
    status: "ok",
    meters: [
      { label: "Included usage", percent: planUsage.totalPercentUsed, resetsAt },
      ...(planUsage.autoPercentUsed !== undefined ? [{ label: "Auto and Composer", percent: planUsage.autoPercentUsed }] : []),
      ...(planUsage.apiPercentUsed !== undefined ? [{ label: "Named API models", percent: planUsage.apiPercentUsed }] : []),
    ],
    // Cursor's dollar totals include free bonus usage and routinely exceed the
    // plan price, so only the percentages (what Cursor itself shows) are honest.
  };
}
