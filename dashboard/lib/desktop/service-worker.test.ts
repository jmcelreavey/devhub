import { describe, expect, it, vi } from "vitest";
import { removeDevhubServiceWorkers, serviceWorkerPlan } from "./service-worker";

describe("serviceWorkerPlan", () => {
  it("removes the worker in the desktop shell, even on a secure context", () => {
    expect(serviceWorkerPlan({ development: false, desktop: true, secureContext: true })).toBe("remove");
  });

  it("removes it in development", () => {
    expect(serviceWorkerPlan({ development: true, desktop: false, secureContext: true })).toBe("remove");
  });

  it("registers in a secure browser context and skips otherwise", () => {
    expect(serviceWorkerPlan({ development: false, desktop: false, secureContext: true })).toBe("register");
    expect(serviceWorkerPlan({ development: false, desktop: false, secureContext: false })).toBe("skip");
  });
});

describe("removeDevhubServiceWorkers", () => {
  it("unregisters workers and deletes only DevHub caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const deleted: string[] = [];
    const removed = await removeDevhubServiceWorkers(
      { getRegistrations: async () => [{ unregister }] },
      {
        keys: async () => ["devhub-pages-v4", "devhub-api-v4", "someone-else"],
        delete: async (name) => {
          deleted.push(name);
          return true;
        },
      },
    );
    expect(removed).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleted).toEqual(["devhub-pages-v4", "devhub-api-v4"]);
  });

  it("reports false when nothing was registered", async () => {
    expect(await removeDevhubServiceWorkers({ getRegistrations: async () => [] }, undefined)).toBe(false);
  });
});
