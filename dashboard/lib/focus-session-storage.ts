/** Browser focus timer session (client-safe). */

export const FOCUS_SESSION_STORAGE_KEY = "devhub-focus-session";
export const FOCUS_SESSION_CHANGED_EVENT = "devhub:focus-session-change";

export interface FocusSessionState {
  endsAt: number;
  totalMs: number;
}

let _cachedRaw: string | null = null;
let _cachedSession: FocusSessionState | null = null;

export function readFocusSession(now = Date.now()): FocusSessionState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(FOCUS_SESSION_STORAGE_KEY);
  if (!raw) {
    _cachedRaw = null;
    _cachedSession = null;
    return null;
  }
  if (raw === _cachedRaw && _cachedSession) return _cachedSession;
  try {
    const session = JSON.parse(raw) as FocusSessionState;
    if (session.endsAt > now) {
      _cachedRaw = raw;
      _cachedSession = session;
      return session;
    }
    localStorage.removeItem(FOCUS_SESSION_STORAGE_KEY);
    _cachedRaw = null;
    _cachedSession = null;
    return null;
  } catch {
    _cachedRaw = null;
    _cachedSession = null;
    return null;
  }
}

function invalidateCache(): void {
  _cachedRaw = null;
  _cachedSession = null;
}

export function writeFocusSession(session: FocusSessionState): void {
  invalidateCache();
  localStorage.setItem(FOCUS_SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(FOCUS_SESSION_CHANGED_EVENT));
}

export function clearFocusSession(): void {
  invalidateCache();
  localStorage.removeItem(FOCUS_SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(FOCUS_SESSION_CHANGED_EVENT));
}

export function subscribeFocusSession(onStoreChange: () => void): () => void {
  const handler = () => onStoreChange();
  window.addEventListener(FOCUS_SESSION_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(FOCUS_SESSION_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
