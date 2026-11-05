import os from "node:os";
import { z } from "zod";
import { execExternal } from "../exec-external";
import { UsageLoadError } from "./load-error";
import type { ProviderUsage } from "./types";

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits";
const KEYCHAIN_SERVICE = "devhub.vercel-ai-gateway";

const dollarAmount = z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite());
const creditsSchema = z.object({
  balance: dollarAmount,
  total_used: dollarAmount,
});

async function readGatewayKey(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return process.env.AI_GATEWAY_API_KEY.trim();
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execExternal("security", ["find-generic-password", "-a", os.userInfo().username, "-s", KEYCHAIN_SERVICE, "-w"], { timeoutMs: 10_000, label: "usage:vercel-keychain" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function loadVercelUsage(): Promise<ProviderUsage | null> {
  const key = await readGatewayKey();
  if (!key) return null;

  let response: Response;
  try {
    response = await fetch(CREDITS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UsageLoadError("Couldn't load Vercel AI Gateway credits.", "Couldn't reach Vercel AI Gateway (network error or timeout).");
  }
  if (response.status === 401 || response.status === 403) {
    throw new UsageLoadError(`Vercel AI Gateway rejected the key (HTTP ${response.status}).`, "Check AI_GATEWAY_API_KEY or the key saved in macOS Keychain.");
  }
  if (!response.ok) throw new UsageLoadError(`Vercel AI Gateway credits failed (HTTP ${response.status}).`, `Vercel AI Gateway answered HTTP ${response.status}.`);

  const credits = creditsSchema.safeParse(await response.json().catch(() => null));
  if (!credits.success) throw new UsageLoadError("Couldn't read Vercel AI Gateway credits.", "Vercel returned credit data in an unexpected format.");

  return {
    id: "vercel",
    name: "Vercel AI Gateway",
    status: "ok",
    meters: [],
    balance: { label: "Remaining credits", amount: credits.data.balance, currency: "USD" },
    spend: [{ label: "All time", amount: credits.data.total_used, currency: "USD", source: "billed" }],
    message: "Team balance. Requests using your own provider key may be billed by that provider.",
  };
}
