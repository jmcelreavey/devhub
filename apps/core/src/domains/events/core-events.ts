export type CoreEventDomain = "notes" | "recall" | "media" | "exec" | "jobs" | "terminal" | "conventions" | "board" | "repo-work" | "skills" | "git" | "ownership" | "db" | "paseo";

type CoreEventListener = (domain: CoreEventDomain) => void;

const eventStore = globalThis as typeof globalThis & { __devhubCoreEventListeners?: Set<CoreEventListener> };
const listeners = eventStore.__devhubCoreEventListeners ??= new Set<CoreEventListener>();

export function emitCoreEvent(domain: CoreEventDomain): void {
  for (const listener of listeners) listener(domain);
}

export function subscribeCoreEvents(listener: CoreEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
