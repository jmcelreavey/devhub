export function applyOptionalIntegrationSettings(overrides: Map<string, string>, input: unknown): void {
  void overrides;
  void input;
  throw new Error("Team Slack is unavailable.");
}

export function isOptionalIntegrationAvailable(): boolean { return false; }

export function activateOptionalIntegrationSettings(overrides: Map<string, string>): void {
  void overrides;
}

export function notifyTaskQuestionResolved(): void {}

export const optionalIntegrationSavedMessage = "";
