import { describe, expect, it } from "vitest";
import { SECRET_FIELD_MASK } from "./shared";
import { jiraSetupSavePayload, shouldSaveBeforeNext } from "./save-payload";

describe("shouldSaveBeforeNext", () => {
  it("still saves Jira when credentials are already marked configured", () => {
    expect(shouldSaveBeforeNext("jira", true)).toBe(true);
  });

  it("skips save on a configured GitHub step (nothing to persist)", () => {
    expect(shouldSaveBeforeNext("github", true)).toBe(false);
  });

  it("saves an unconfigured paths step", () => {
    expect(shouldSaveBeforeNext("paths", false)).toBe(true);
  });
});

describe("jiraSetupSavePayload", () => {
  it("includes a replacement token even when Jira is already configured", () => {
    const result = jiraSetupSavePayload(
      {
        domain: "example.atlassian.net",
        email: "dev@example.com",
        apiToken: "new-token",
      },
      true,
    );
    expect(result).toEqual({
      ok: true,
      jira: {
        domain: "example.atlassian.net",
        email: "dev@example.com",
        apiToken: "new-token",
      },
    });
  });

  it("omits a masked token so Next keeps the saved secret", () => {
    const result = jiraSetupSavePayload(
      {
        domain: "example.atlassian.net",
        email: "dev@example.com",
        apiToken: SECRET_FIELD_MASK,
      },
      true,
    );
    expect(result).toEqual({
      ok: true,
      jira: {
        domain: "example.atlassian.net",
        email: "dev@example.com",
      },
    });
  });

  it("rejects first-run Next with no token", () => {
    const result = jiraSetupSavePayload(
      { domain: "example.atlassian.net", email: "dev@example.com", apiToken: "" },
      false,
    );
    expect(result.ok).toBe(false);
  });
});
