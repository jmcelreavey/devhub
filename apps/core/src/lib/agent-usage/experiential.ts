import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { UsageLoadError } from "./load-error";
import type { ProviderUsage } from "./types";

// https://platform.experientiallabs.ai/docs/cost-api
const creditsSchema = z.object({
  data: z.object({
    total_credits: z.number().finite().nonnegative(),
    total_usage: z.number().finite().nonnegative(),
  }),
});

async function readExperientialKey(): Promise<string | null> {
  const key = process.env.EXPLABS_API_KEY?.trim();
  if (key) return key;
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  for (const filename of ["experiential_paseo_api_key", "experiential_api_key"]) {
    try {
      const saved = (await fs.readFile(path.join(config, "devhub", "secrets", filename), "utf8")).trim();
      if (saved) return saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new UsageLoadError("Couldn't read the Experiential Labs key.", "Check permissions on the saved Experiential Labs key file.");
      }
    }
  }
  return null;
}

export async function loadExperientialUsage(): Promise<ProviderUsage | null> {
  const key = await readExperientialKey();
  if (!key) return null;

  let response: Response;
  try {
    response = await fetch("https://api.experientiallabs.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new UsageLoadError("Couldn't load Experiential Labs credits.", "Couldn't reach Experiential Labs (network error or timeout).");
  }
  if (response.status === 401 || response.status === 403) {
    throw new UsageLoadError(`Experiential Labs rejected the key (HTTP ${response.status}).`, "Check EXPLABS_API_KEY or the saved Experiential Labs key file.");
  }
  if (!response.ok) throw new UsageLoadError(`Experiential Labs credits failed (HTTP ${response.status}).`, `Experiential Labs answered HTTP ${response.status}.`);

  const credits = creditsSchema.safeParse(await response.json().catch(() => null));
  if (!credits.success) throw new UsageLoadError("Couldn't read Experiential Labs credits.", "Experiential Labs returned credit data in an unexpected format.");

  const { total_credits, total_usage } = credits.data.data;
  return {
    id: "experiential",
    name: "Experiential Labs",
    status: "ok",
    meters: [],
    balance: { label: "Remaining credits", amount: total_credits - total_usage, currency: "USD" },
    spend: [{ label: "Total usage", amount: total_usage, currency: "USD", source: "billed" }],
    message: "Organisation credits and usage. Requests using your own provider key are billed by that provider.",
  };
}
