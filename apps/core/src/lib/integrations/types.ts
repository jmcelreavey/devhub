import type { z } from "zod";
import type { integrationWriteInput } from "../../../../../packages/shared/actions/integrations";
import type { IntegrationRef } from "../../../../../packages/shared/integration-ref";
export type { IntegrationRef };
export { integrationRefInput as RefSchema } from "../../../../../packages/shared/actions/integrations";
export interface IntegrationItem {
  ref: IntegrationRef;
  title: string;
  url?: string;
  revision?: string;
  status?: { id: string; label: string; category?: string };
  draft?: boolean;
  metadata?: Record<string, unknown>;
}
export interface IntegrationContext { signal: AbortSignal }
export interface IntegrationAccount { provider: string; id: string; label: string }
export interface IntegrationAlert {
  id: string;
  title: string;
  timestampMs: number;
  status?: string;
  url: string;
}
export interface IntegrationAlertBatch {
  oncall: IntegrationAlert[];
  related: IntegrationAlert[];
}
export interface IntegrationSetupStatus {
  configured: boolean;
  fields: Record<string, boolean | string>;
}
export interface IntegrationProvider {
  id: string;
  pluginName?: string;
  apiVersion: 1;
  label: string;
  capabilities: readonly string[];
  accounts(): IntegrationAccount[] | Promise<IntegrationAccount[]>;
  get(ref: IntegrationRef, context: IntegrationContext): Promise<IntegrationItem>;
  setupStatus?(): IntegrationSetupStatus | Promise<IntegrationSetupStatus>;
  alerts?: { recent(limit: number): Promise<IntegrationAlertBatch> };
  transitions?(ref: IntegrationRef, context: IntegrationContext): Promise<Array<{ id: string; label: string; statusId?: string; statusLabel?: string }>>;
  prepareWrite?(input: WriteInput, context: IntegrationContext): Promise<PreparedWrite>;
  executeWrite?(input: WriteInput, prepared: PreparedWrite, context: WriteContext): Promise<WriteReceipt>;
}
export type IntegrationErrorKind = "auth" | "rate-limit" | "not-found" | "unsupported" | "conflict" | "unavailable" | "invalid";
export class IntegrationError extends Error {
  constructor(public kind: IntegrationErrorKind, message: string, public retryAfter?: number) { super(message); }
}
export function refKey(ref: IntegrationRef): string { return JSON.stringify([ref.provider, ref.account, ref.kind, ref.id]); }
export function assertCapability(provider: IntegrationProvider, capability: string) {
  if (!provider.capabilities.includes(capability)) throw new IntegrationError("unsupported", "This provider does not support " + capability + ".");
}

export type WriteInput = z.infer<typeof integrationWriteInput>;
export interface PreparedWrite {
  destination: string;
  actor: string;
  summary: string;
  details: Record<string, unknown>;
  /** Exact native request plus remote revision/branch evidence. Never credentials. */
  native: Record<string, unknown>;
}
export interface WriteContext { signal: AbortSignal; requestId: string }
export interface WriteReceipt { item?: IntegrationItem; detail: string }
export interface WriteResult {
  id: string;
  profile: string;
  input: WriteInput;
  source: string;
  createdAt: string;
  state: "unknown" | "succeeded" | "failed";
  prepared?: PreparedWrite;
  detail?: string;
  confirmedAt?: string;
  finishedAt?: string;
  receipt?: WriteReceipt;
  taskJiraKey?: string | null;
  taskLink?: "linked" | "skipped" | "failed";
}
