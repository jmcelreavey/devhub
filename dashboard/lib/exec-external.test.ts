import { describe, expect, it } from "vitest";
import { execExternal } from "./exec-external";
import { GitMissingError } from "./setup/git-check";

describe("execExternal", () => {
  it("explains a missing git instead of surfacing `spawn git ENOENT`", async () => {
    const error = await execExternal("git", ["--version"], { env: { PATH: "" } as unknown as NodeJS.ProcessEnv }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitMissingError);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect((error as Error).message).toMatch(/Git isn't installed/);
  });
  it("leaves other missing programs as they were", async () => {
    const error = await execExternal("devhub-no-such-tool", [], { env: { PATH: "" } as unknown as NodeJS.ProcessEnv }).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(GitMissingError);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});
