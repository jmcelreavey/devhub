import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { patchEnvFileKeys } from "./dashboard-env-local";

const originalEnvFile = process.env.DEVHUB_ENV_FILE;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-env-local-"));
  process.env.DEVHUB_ENV_FILE = path.join(tmp, "primary.env");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalEnvFile === undefined) delete process.env.DEVHUB_ENV_FILE;
  else process.env.DEVHUB_ENV_FILE = originalEnvFile;
});

describe("patchEnvFileKeys", () => {
  it("replaces Jira token in a sibling env file without dropping other keys", () => {
    const dest = path.join(tmp, "packaged.env");
    fs.writeFileSync(
      dest,
      [
        "NOTES_DIR=/tmp/notes",
        "JIRA_DOMAIN=example.atlassian.net",
        "JIRA_EMAIL=dev@example.com",
        "JIRA_API_TOKEN=dead-token",
        "UNMANAGED=keep-me",
        "",
      ].join("\n"),
    );

    patchEnvFileKeys(
      dest,
      new Map([
        ["JIRA_DOMAIN", "example.atlassian.net"],
        ["JIRA_EMAIL", "dev@example.com"],
        ["JIRA_API_TOKEN", "live-token"],
      ]),
      ["JIRA_DOMAIN", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    );

    const written = fs.readFileSync(dest, "utf8");
    expect(written).toContain("JIRA_API_TOKEN=live-token");
    expect(written).not.toContain("dead-token");
    expect(written).toContain("NOTES_DIR=/tmp/notes");
    expect(written).toContain("UNMANAGED=keep-me");
  });

  it("no-ops when destination is the process env file", () => {
    const dest = process.env.DEVHUB_ENV_FILE!;
    fs.writeFileSync(dest, "JIRA_API_TOKEN=dead-token\n");
    patchEnvFileKeys(dest, new Map([["JIRA_API_TOKEN", "live-token"]]), ["JIRA_API_TOKEN"]);
    expect(fs.readFileSync(dest, "utf8")).toContain("JIRA_API_TOKEN=dead-token");
  });
});
