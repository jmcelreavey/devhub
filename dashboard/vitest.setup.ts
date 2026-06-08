/**
 * Vitest setup: polyfill localStorage for BlockNote / xl-ai imports in Node.
 */
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
