import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const originalEnvFile = process.env.DEVHUB_ENV_FILE;
const originalMirror = process.env.DEVHUB_MIRROR_ENV_FILE;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-setup-save-"));
  process.env.DEVHUB_ENV_FILE = path.join(tmp, ".env.local");
  process.env.DEVHUB_MIRROR_ENV_FILE = path.join(tmp, "packaged.env");
  fs.writeFileSync(
    process.env.DEVHUB_ENV_FILE,
    [
      "JIRA_DOMAIN=example.atlassian.net",
      "JIRA_EMAIL=dev@example.com",
      "JIRA_API_TOKEN=dead-token",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    process.env.DEVHUB_MIRROR_ENV_FILE,
    [
      "NOTES_DIR=/tmp/notes",
      "JIRA_DOMAIN=example.atlassian.net",
      "JIRA_EMAIL=dev@example.com",
      "JIRA_API_TOKEN=dead-token",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (originalEnvFile === undefined) delete process.env.DEVHUB_ENV_FILE;
  else process.env.DEVHUB_ENV_FILE = originalEnvFile;
  if (originalMirror === undefined) delete process.env.DEVHUB_MIRROR_ENV_FILE;
  else process.env.DEVHUB_MIRROR_ENV_FILE = originalMirror;
});

const { POST } = await import("./route");

function request(body: unknown): NextRequest {
  return new NextRequest("http://test/api/setup/save", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/setup/save jira", () => {
  it("persists a replacement API token when Jira is already configured", async () => {
    const res = await POST(
      request({
        jira: {
          domain: "example.atlassian.net",
          email: "dev@example.com",
          apiToken: "replacement-token",
        },
      }),
    );
    expect(res.status).toBe(200);
    const primary = fs.readFileSync(process.env.DEVHUB_ENV_FILE!, "utf8");
    expect(primary).toContain("JIRA_API_TOKEN=replacement-token");
    expect(primary).not.toContain("dead-token");
    const mirrored = fs.readFileSync(process.env.DEVHUB_MIRROR_ENV_FILE!, "utf8");
    expect(mirrored).toContain("JIRA_API_TOKEN=replacement-token");
    expect(mirrored).toContain("NOTES_DIR=/tmp/notes");
  });
});
