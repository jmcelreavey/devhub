import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listAwsProfiles, detectBiPresence } from "./bi-presence";

let home: string;
const SAVE = process.env.AWS_PROFILE;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aws-"));
  delete process.env.AWS_PROFILE;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  if (SAVE === undefined) delete process.env.AWS_PROFILE;
  else process.env.AWS_PROFILE = SAVE;
});

function writeAws(file: string, content: string): void {
  fs.mkdirSync(path.join(home, ".aws"), { recursive: true });
  fs.writeFileSync(path.join(home, ".aws", file), content);
}

const none = () => null;

describe("listAwsProfiles", () => {
  it("parses profile names from config and credentials", () => {
    writeAws("config", "[profile dev]\nregion=eu-west-1\n[profile prod]\n");
    writeAws("credentials", "[default]\naws_access_key_id=x\n");
    expect(listAwsProfiles(home)).toEqual(["default", "dev", "prod"]);
  });
  it("returns [] when no aws files exist", () => {
    expect(listAwsProfiles(home)).toEqual([]);
  });
});

describe("detectBiPresence", () => {
  it("is false with nothing configured", () => {
    expect(detectBiPresence(none, home)).toEqual({ bi: false, awsProfile: null, capiRepoPath: null });
  });

  it.each([true, false])("exposes setup for an enabled plugin before AWS is configured (enabled=%s)", (enabled) => {
    const plugin = path.join(home, "plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({
      name: "bi", version: "1", devhubApi: "1", contributes: {}, navGate: "bi",
    }));
    const file = path.join(home, ".config/devhub/plugins.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ plugins: [{ name: "bi", path: plugin, enabled }] }));
    expect(detectBiPresence(none, home)).toEqual({ bi: enabled, awsProfile: null, capiRepoPath: null });
  });

  it("is true when an AWS profile env is set, and prefers it", () => {
    const r = detectBiPresence((k) => (k === "AWS_PROFILE" ? "work" : null), home);
    expect(r.bi).toBe(true);
    expect(r.awsProfile).toBe("work");
  });

  it("is true from configured profiles, picking the first", () => {
    writeAws("config", "[profile dev]\n[profile prod]\n");
    const r = detectBiPresence(none, home);
    expect(r.bi).toBe(true);
    expect(r.awsProfile).toBe("dev");
  });

  it("is true when BI_OPS_USER_EMAIL or CAPI_REPO_PATH is set", () => {
    expect(detectBiPresence((k) => (k === "BI_OPS_USER_EMAIL" ? "a@b" : null), home).bi).toBe(true);
    const r = detectBiPresence((k) => (k === "CAPI_REPO_PATH" ? "/repo" : null), home);
    expect(r.bi).toBe(true);
    expect(r.capiRepoPath).toBe("/repo");
  });
});
