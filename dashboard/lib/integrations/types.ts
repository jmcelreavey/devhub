import { z } from "zod";
import type { IntegrationRef } from "../../../shared/integration-ref";
export type { IntegrationRef };
export const RefSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
  account: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  kind: z.enum(["issue", "repo", "pr", "check", "doc", "chat"]),
  id: z.string().trim().min(1).max(500),
}).strict();
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
export interface IntegrationProvider {
  id: string;
  apiVersion: 1;
  label: string;
  capabilities: readonly string[];
  accounts(): IntegrationAccount[];
  get(ref: IntegrationRef, context: IntegrationContext): Promise<IntegrationItem>;
  transitions?(ref: IntegrationRef, context: IntegrationContext): Promise<Array<{ id: string; label: string; statusId?: string; statusLabel?: string }>>;
  prepareWrite?(input: import("./write-types").WriteInput, context: IntegrationContext): Promise<import("./write-types").PreparedWrite>;
  executeWrite?(input: import("./write-types").WriteInput, prepared: import("./write-types").PreparedWrite, context: import("./write-types").WriteContext): Promise<import("./write-types").WriteReceipt>;
}
export type IntegrationErrorKind = "auth" | "rate-limit" | "not-found" | "unsupported" | "conflict" | "unavailable" | "invalid";
export class IntegrationError extends Error {
  constructor(public kind: IntegrationErrorKind, message: string, public retryAfter?: number) { super(message); }
}
export function refKey(ref: IntegrationRef): string { return JSON.stringify([ref.provider, ref.account, ref.kind, ref.id]); }
export function assertCapability(provider: IntegrationProvider, capability: string) {
  if (!provider.capabilities.includes(capability)) throw new IntegrationError("unsupported", "This provider does not support " + capability + ".");
}
