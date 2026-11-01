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
