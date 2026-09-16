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

if (!hasDom || typeof window.localStorage === "undefined") {
  // Two cases need this polyfill:
  // - node env: nothing provides localStorage at all.
  // - jsdom on Node >= 26: Node's experimental global `localStorage` (which is
  //   inert without --localstorage-file) shadows jsdom's own implementation,
  //   so `window.localStorage` comes through undefined and every component
  //   test touching storage dies on the first access. Provide a working
  //   in-memory storage either way; jsdom persists nothing between files by
  //   design, so nothing loses behaviour it had.
  const storage = new Map<string, string>();
  const shim = {
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
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true });
  if (hasDom && typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: shim, configurable: true });
  }
}
if (hasDom) {
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

  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
}
