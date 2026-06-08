import { describe, expect, it } from "vitest";
import type { MasterList } from "./types";
import { applyOptimisticMasterPatch, mergeMasterPatchResponse } from "./mutate-cache";

const base: MasterList = {
  schemaVersion: 2,
  id: "m1",
  name: "Garden",
  scopePath: "garden",
  items: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("mutate-cache", () => {
  it("optimistically adds then merges server item", () => {
    const optimistic = applyOptimisticMasterPatch([base], "m1", {
      action: "addItem",
      item: { name: "Spade", checked: false },
    });
    expect(optimistic[0].items).toHaveLength(1);
    expect(optimistic[0].items[0].id).toMatch(/^optimistic-/);

    const merged = mergeMasterPatchResponse([optimistic[0]], "m1", { action: "addItem" }, {
      id: "real-id",
      name: "Spade",
      checked: false,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(merged[0].items).toHaveLength(1);
    expect(merged[0].items[0].id).toBe("real-id");
  });

  it("merges updateCollection response", () => {
    const merged = mergeMasterPatchResponse([base], "m1", { action: "updateCollection" }, {
      ...base,
      icon: "sprout",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    expect(merged[0].icon).toBe("sprout");
  });
});
