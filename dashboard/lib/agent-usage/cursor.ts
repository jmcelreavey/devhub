import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execExternal } from "@/lib/exec-external";
import type { ProviderUsage } from "./types";

// cursor.com's dashboard accepts the desktop app's own access token as its
// session cookie (`<userId>::<jwt>`), so there is no browser cookie jar to
// decrypt. These endpoints are what cursor.com/dashboard calls; undocumented.
const CURSOR_ORIGIN = "https://cursor.com";

function stateDbPath(): string {
  const home = os.homedir();
  return process.platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Cursor", "User", "globalStorage", "state.vscdb");
}

const claimsSchema = z.object({ sub: z.string().min(1), exp: z.number().optional() });

const periodUsageSchema = z.object({
  billingCycleEnd: z.string().optional(),
  planUsage: z.object({
    autoPercentUsed: z.number().optional(),
    apiPercentUsed: z.number().optional(),
    totalPercentUsed: z.number(),
  }),
});

const planInfoSchema = z.object({ planInfo: z.object({ planName: z.string() }).optional() });

async function readAccessToken(): Promise<string | null> {
  const db = stateDbPath();
  if (!fs.existsSync(db)) return null;
  // sqlite3 in a subprocess rather than node:sqlite: the file is multi-GB and a
  // synchronous read on the main thread would stall every route while it runs.
  const query = "select value from ItemTable where key = 'cursorAuth/accessToken'";
  const run = (target: string) => execExternal("sqlite3", ["-readonly", target, query], { timeoutMs: 10_000, label: "usage:cursor-token" });
  try {
    return (await run(db)).stdout.trim() || null;
  } catch {
    // A WAL-mode database with no -wal/-shm files (Cursor closed) can't be opened
    // read-only: SQLite wants to create them. With Cursor closed there is no WAL
    // to miss, so an immutable open reads the main file safely.
    const uri = `${pathToFileURL(db).href}?immutable=1`;
    return (await run(uri)).stdout.trim() || null;
  }
}

async function cursorPost(endpoint: string, cookie: string): Promise<unknown> {
  const response = await fetch(`${CURSOR_ORIGIN}/api/dashboard/${endpoint}`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: CURSOR_ORIGIN, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Cursor ${endpoint} failed (HTTP ${response.status}).`);
  return response.json();
}

export async function loadCursorUsage(): Promise<ProviderUsage> {
  const base = { id: "cursor", name: "Cursor", meters: [], spend: [] } satisfies Partial<ProviderUsage>;
  const token = await readAccessToken();
  if (!token) return { ...base, status: "unavailable", message: "Sign in to the Cursor app to see plan usage." };

  let claims: z.infer<typeof claimsSchema>;
  try {
    claims = claimsSchema.parse(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")));
  } catch {
    return { ...base, status: "error", message: "Cursor's stored sign-in is in an unexpected format." };
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) return { ...base, status: "unavailable", message: "Cursor's sign-in has expired. Open Cursor to refresh it." };

  // `sub` looks like "google-oauth2|user_01…"; the cookie wants the user id part.
  const userId = claims.sub.split("|").pop();
  const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${token}`;
  const [periodRaw, planRaw] = await Promise.all([cursorPost("get-current-period-usage", cookie), cursorPost("get-plan-info", cookie)]);
  const period = periodUsageSchema.parse(periodRaw);
  const plan = planInfoSchema.parse(planRaw).planInfo?.planName;
  const resetsAt = period.billingCycleEnd ? new Date(Number(period.billingCycleEnd)).toISOString() : undefined;
  const { planUsage } = period;

  return {
    ...base,
    plan,
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
