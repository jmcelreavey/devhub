export type UsageProviderId = "claude" | "codex" | "cursor" | "copilot" | "openrouter" | "zai";

export interface UsageMeter {
  label: string;
  /** 0–100 share of the allowance used. */
  percent: number;
  resetsAt?: string;
}

export interface UsageSpend {
  label: string;
  amount: number;
  currency: string;
  limit?: number;
  /** "billed" comes from the vendor's billing API; "estimate" is our own maths on local logs. */
  source: "billed" | "estimate";
}

export interface ProviderUsage {
  id: UsageProviderId;
  name: string;
  plan?: string;
  status: "ok" | "unavailable" | "error";
  /** One plain line: the state of this provider, shown as the card headline when it has no numbers. */
  summary?: string;
  /** The single command that fixes it. Rendered as code with a copy button. */
  command?: string;
  /** Why a provider is unavailable or failed, or a caveat worth showing next to the numbers. May contain `backtick` code. */
  message?: string;
  /** A short cause for a failure (sign-in rejected, network, changed API), shown behind Details. */
  reason?: string;
  meters: UsageMeter[];
  spend: UsageSpend[];
}
