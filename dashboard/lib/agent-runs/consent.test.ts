import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Partial env for tests: NODE_ENV and friends are filled in loosely. */
const envOf = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentConsentFile, consentKey, hasConsented, readConsents, recordConsent } from "./consent";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-consent-"));
  file = path.join(dir, "nested", "agent-consent.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("consent store", () => {
  it("starts empty and denies", () => {
    expect(readConsents(file)).toEqual({});
    expect(hasConsented(file, "claude", "/repo")).toBe(false);
  });

  it("records and remembers a provider+repo pair", () => {
    recordConsent(file, "claude", "/repo");
    expect(hasConsented(file, "claude", "/repo")).toBe(true);
    expect(hasConsented(file, "cursor", "/repo")).toBe(false);
    expect(hasConsented(file, "claude", "/other")).toBe(false);
    expect(Object.keys(readConsents(file))).toEqual([consentKey("claude", "/repo")]);
  });

  it("creates parent dirs with tight permissions", () => {
    recordConsent(file, "claude", "/repo");
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("survives a reload and ignores junk entries", () => {
    recordConsent(file, "claude", "/repo");
    fs.writeFileSync(file, JSON.stringify({ ...readConsents(file), junk: "not-a-number" }));
    expect(readConsents(file)[consentKey("claude", "/repo")]).toBeGreaterThan(0);
    expect(readConsents(file).junk).toBeUndefined();
  });

  it("missing file env falls back to app data path", () => {
    expect(agentConsentFile(envOf({}))).toContain("agent-consent.json");
    expect(agentConsentFile(envOf({ DEVHUB_AGENT_CONSENT_FILE: "/x/y.json" }))).toBe("/x/y.json");
  });
});
