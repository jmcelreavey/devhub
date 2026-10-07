/**
 * Whether the dashboard should run its offline service worker, and how to
 * remove one that should not be there.
 *
 * Kept out of the component so the decision is testable without a browser.
 */

export interface ServiceWorkerContext {
  development: boolean;
  /** Inside the packaged desktop shell (Tauri webview). */
  desktop: boolean;
  secureContext: boolean;
}

export type ServiceWorkerPlan = "register" | "remove" | "skip";

/**
 * - Development: remove. Packaged and attached modes share localhost:1337 and
 *   so one worker scope; a production worker's cache rules pin stale webpack
 *   assets during hot reload.
 * - Desktop shell: remove. The shell has its own boot and failure screens, so
 *   the worker's offline fallback buys nothing there, and on Windows (WebView2
 *   in front of a WSL backend) a registered worker intercepting the one-shot
 *   bootstrap navigation held the window on "Ready — opening…" for about a
 *   minute on every launch after the first. Measured on a real install: 0.5s
 *   with no registration, ~60s with one.
 * - Browser on a secure context: register (installable PWA, offline shell).
 */
export function serviceWorkerPlan(ctx: ServiceWorkerContext): ServiceWorkerPlan {
  if (ctx.development || ctx.desktop) return "remove";
  return ctx.secureContext ? "register" : "skip";
}

interface RegistrationLike {
  unregister(): Promise<boolean>;
}

interface ServiceWorkerContainerLike {
  getRegistrations(): Promise<readonly RegistrationLike[]>;
}

interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Unregister every worker for this origin and drop DevHub's caches.
 * Resolves to true when a worker was actually removed.
 */
export async function removeDevhubServiceWorkers(
  container: ServiceWorkerContainerLike,
  cacheStorage: CacheStorageLike | undefined,
): Promise<boolean> {
  const registrations = await container.getRegistrations();
  const removed = await Promise.all(registrations.map((registration) => registration.unregister()));
  if (cacheStorage) {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((name) => name.startsWith("devhub-")).map((name) => cacheStorage.delete(name)));
  }
  return removed.some(Boolean);
}
