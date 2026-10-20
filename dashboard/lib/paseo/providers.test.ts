import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./client", () => ({
  withPaseo: async (fn: (session: { api: { providers: { snapshot: () => Promise<{ entries: unknown[] }> } } }) => Promise<unknown>) => {
    mock.calls += 1;
    return fn({
      api: {
        providers: {
          snapshot: async () => ({
            entries: [{ provider: "claude", enabled: true, status: "ready", label: "Claude", models: [{ id: "haiku" }] }],
          }),
        },
      },
    });
  },
}));

import { clearPaseoProviderCache, listPaseoProviders } from "./providers";

beforeEach(() => {
  mock.calls = 0;
  clearPaseoProviderCache();
});

describe("Paseo provider snapshot", () => {
  it("reuses a snapshot across the launch sheet and Start chat", async () => {
    const first = await listPaseoProviders();
    const second = await listPaseoProviders();
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({ id: "claude", ready: true, models: ["haiku"] });
    expect(mock.calls).toBe(1);
  });

  it("shares one in-flight snapshot", async () => {
    const [first, second] = await Promise.all([listPaseoProviders(), listPaseoProviders()]);
    expect(second).toEqual(first);
    expect(mock.calls).toBe(1);
  });
});
