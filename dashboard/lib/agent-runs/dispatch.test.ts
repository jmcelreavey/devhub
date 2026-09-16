import { describe, expect, it } from "vitest";

/** Partial env for tests: NODE_ENV and friends are filled in loosely. */
const envOf = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;
import { cwdAllowedRoots } from "./dispatch";

describe("cwdAllowedRoots", () => {
  it("is empty when unset", () => {
    expect(cwdAllowedRoots(envOf({}))).toEqual([]);
  });

  it("splits on colons and expands ~", () => {
    const roots = cwdAllowedRoots(envOf({ DEVHUB_AGENT_ALLOWED_ROOTS: "~/Developer:/tmp/repos" }));
    expect(roots[0]).toMatch(/\/Developer$/);
    expect(roots[1]).toBe("/tmp/repos");
  });

  it("drops empty segments", () => {
    expect(cwdAllowedRoots(envOf({ DEVHUB_AGENT_ALLOWED_ROOTS: "~/Developer::/tmp" })).length).toBe(2);
  });
});
