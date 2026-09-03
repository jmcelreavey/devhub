import { beforeEach, describe, expect, it, vi } from "vitest";
import { findDbConnection } from "./registry";
import { mongoDatabaseName } from "./introspect";

vi.mock("./registry", () => ({ findDbConnection: vi.fn() }));

const findConnection = vi.mocked(findDbConnection);

describe("mongoDatabaseName", () => {
  beforeEach(() => findConnection.mockReset());

  it("uses the provider's bound database instead of parsing the connection id", async () => {
    findConnection.mockResolvedValue({
      id: "bi:mongo:fantasy-stocks:dev",
      label: "Fantasy Stocks · dev",
      engine: "mongodb",
      database: "fantasyStocks",
      accessMode: "read",
      dangerous: false,
      source: "plugin:bi",
    });

    await expect(mongoDatabaseName("bi:mongo:fantasy-stocks:dev")).resolves.toBe("fantasyStocks");
  });
});
