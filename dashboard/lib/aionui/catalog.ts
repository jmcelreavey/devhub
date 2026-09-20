import { AionClient } from "./client";
import type { AionAssistant } from "./contracts";
import { currentAionSession } from "./session";

export function assistantForProvider(assistants: AionAssistant[], provider: string): AionAssistant | undefined {
  const backend = provider === "chatgpt" ? "codex" : provider;
  return assistants.find((assistant) => assistant.id === provider)
    ?? assistants.find((assistant) => assistant.enabled && assistant.agent?.acp_backend === backend && assistant.id.startsWith("bare:"));
}

export async function aionCatalog() {
  const session = await currentAionSession();
  const client = new AionClient(session);
  const assistants = await client.listAssistants();
  return { session, client, assistants };
}
