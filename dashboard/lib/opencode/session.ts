/**
 * Tiny client-side channel for steering the persistent OpenCode iframe to a
 * specific session. The iframe lives on a different origin (ephemeral OpenCode port) so the
 * parent can't read its location — but it *can* set `src`. Callers (e.g. the
 * Datadog "Investigate" button) request a session id here; PersistentOpenCode
 * subscribes and points the iframe at `/session/{id}`.
 */

type Listener = (sessionId: string) => void;

let pending: string | null = null;
const listeners = new Set<Listener>();

/** Ask the OpenCode iframe to open a session (created server-side). */
export function requestOpenCodeSession(sessionId: string): void {
  pending = sessionId;
  for (const l of listeners) l(sessionId);
  // Soft-navigate so non-component callers (PR row menus) land on /opencode.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("devhub:navigate", { detail: { href: "/opencode" } }));
  }
}

/** Read + clear any session requested before the listener mounted. */
export function consumePendingOpenCodeSession(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onOpenCodeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
