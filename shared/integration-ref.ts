/** A provider's native ID is meaningful only inside its account and domain. */
export interface IntegrationRef {
  provider: string;
  account: string;
  kind: "issue" | "repo" | "pr" | "check" | "doc" | "chat";
  id: string;
}
