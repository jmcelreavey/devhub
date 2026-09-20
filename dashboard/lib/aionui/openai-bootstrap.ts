import { AionClient } from "./client";
import type { AionSession } from "./session";
import { withMutex } from "@/lib/atomic-write";

export const DEVHUB_OPENAI_PROVIDER_ID = "devhub-openai";
export const DEVHUB_AION_CLI_MODEL = "gpt-5.6-luna";
export const DEVHUB_AION_CLI_ASSISTANT_NAME = "Aion CLI";

function readAiConfig() {
  const apiKey = process.env.AI_API_KEY?.trim();
  const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey) return null;
  return { apiKey, baseUrl };
}

/** Ensure AionUi has DevHub's OpenAI key and prefers gpt-5.6-luna for Aion CLI. */
export async function ensureAionOpenAiBootstrap(session: AionSession): Promise<{ providerId: string; model: string } | null> {
  const config = readAiConfig();
  if (!config) return null;
  return withMutex("aionui:openai-bootstrap", async () => {
    const client = new AionClient(session);
    const providers = await client.listProviders();
    const existing = providers.find((provider) => provider.id === DEVHUB_OPENAI_PROVIDER_ID)
      || providers.find((provider) => provider.platform === "openai");
    const body = {
      platform: "openai",
      name: "OpenAI (DevHub)",
      base_url: config.baseUrl,
      api_key: config.apiKey,
      models: [DEVHUB_AION_CLI_MODEL],
      enabled: true,
      model_enabled: { [DEVHUB_AION_CLI_MODEL]: true },
      model_protocols: { [DEVHUB_AION_CLI_MODEL]: "openai" },
    };
    const providerId = existing
      ? (await client.updateProvider(existing.id, body), existing.id)
      : (await client.createProvider({ id: DEVHUB_OPENAI_PROVIDER_ID, ...body })).id;
    return { providerId, model: DEVHUB_AION_CLI_MODEL };
  });
}
