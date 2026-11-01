/**
 * In-process TTL cache for GET /api/jira/tickets.
 * Mutations (transition, create) must call invalidateJiraTicketsCache().
 */

import { emitCoreEvent } from "../../domains/events/core-events";

let cache: { data: unknown; ts: number } | null = null;

export const JIRA_TICKETS_TTL_MS = 2 * 60 * 1000;

export function getJiraTicketsCache(): { data: unknown; ts: number } | null {
  return cache;
}

export function setJiraTicketsCache(data: unknown): void {
  cache = { data, ts: Date.now() };
  emitCoreEvent("board");
}

export function invalidateJiraTicketsCache(): void {
  if (!cache) return;
  cache = null;
  emitCoreEvent("board");
}
