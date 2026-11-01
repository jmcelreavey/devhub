export const AI_PROVIDER_IDS = ["cursor-cli", "chatgpt-cli", "antigravity-cli", "opencode", "api"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

