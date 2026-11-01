/** Which AI provider setup should preselect. No subprocesses. */

export const SETUP_AI_PROVIDERS = [
  "cursor-cli",
  "chatgpt-cli",
  "antigravity-cli",
  "opencode",
  "api",
] as const;

export type SetupAiProviderId = (typeof SETUP_AI_PROVIDERS)[number];

export function pickInstalledAiProvider(input: {
  saved: string | null | undefined;
  installed: Partial<Record<SetupAiProviderId, boolean>>;
}): SetupAiProviderId | null {
  if (input.saved && (SETUP_AI_PROVIDERS as readonly string[]).includes(input.saved) && input.installed[input.saved as SetupAiProviderId]) {
    return input.saved as SetupAiProviderId;
  }
  return SETUP_AI_PROVIDERS.find((id) => input.installed[id]) ?? null;
}
