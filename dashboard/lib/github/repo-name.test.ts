import { describe, expect, it } from "vitest";
import { parseOwnerRepo } from "./repo-name";

describe("parseOwnerRepo", () => {
  it("splits owner/name", () => {
    expect(parseOwnerRepo("acme/widgets")).toEqual({ owner: "acme", name: "widgets" });
  });

  it("rejects junk", () => {
    expect(parseOwnerRepo("../etc/passwd")).toBeNull();
    expect(parseOwnerRepo("no-slash")).toBeNull();
  });
});
