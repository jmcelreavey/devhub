/**
 * Vitest setup. Runs for both environments, so everything here is guarded on
 * whether a DOM is actually present.
 *
 * - node: polyfill localStorage, which BlockNote / xl-ai touch at import time.
 * - jsdom (`*.test.tsx`): jest-dom matchers + Testing Library auto-cleanup.
 */
// Marks the file as a module so the top-level `await`s below are legal.
export {};

const hasDom = typeof window !== "undefined";

if (!hasDom) {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
    },
    configurable: true,
  });
} else {
  const { cleanup } = await import("@testing-library/react");
  const { afterEach } = await import("vitest");
  await import("@testing-library/jest-dom/vitest");

  afterEach(() => cleanup());

  // jsdom implements neither, and components that measure or animate call both.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}
