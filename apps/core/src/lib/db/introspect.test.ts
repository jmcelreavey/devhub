import { beforeEach, describe, expect, it, vi } from "vitest";
import { findDbConnection } from "./registry";
import { mongoDatabaseName } from "./introspect";

vi.mock("./registry", () => ({ findDbConnection: vi.fn() }));

const findConnection = vi.mocked(findDbConnection);

describe("mongoDatabaseName", () => {
  beforeEach(() => findConnection.mockReset());

  it("uses the provider's bound database instead of parsing the connection id", async () => {
    findConnection.mockResolvedValue({
      id: "team:mongo:sample-data:dev",
      label: "Fantasy Stocks · dev",
      engine: "mongodb",
      database: "sampleData",
      accessMode: "read",
      dangerous: false,
      source: "plugin:team-tools",
    });

    await expect(mongoDatabaseName("team:mongo:sample-data:dev")).resolves.toBe("sampleData");
  });
});
