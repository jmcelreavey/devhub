import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectInfrastructurePresence, listAwsProfiles } from "./infrastructure-presence";

let home: string;
const savedProfile = process.env.AWS_PROFILE;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-infra-")); delete process.env.AWS_PROFILE; });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); if (savedProfile === undefined) delete process.env.AWS_PROFILE; else process.env.AWS_PROFILE = savedProfile; });

function writeAws(file: string, content: string): void {
  fs.mkdirSync(path.join(home, ".aws"), { recursive: true });
  fs.writeFileSync(path.join(home, ".aws", file), content);
}

describe("infrastructure presence", () => {
  it("stays off without configuration", () => {
    expect(listAwsProfiles(home)).toEqual([]);
    expect(detectInfrastructurePresence(() => null, home)).toEqual({ infra: false, awsProfile: null, scriptsRepoPath: null });
  });
  it("reads generic AWS profiles and prefers an explicit profile", () => {
    writeAws("config", "[profile dev]\nregion=eu-west-1\n[profile prod]\n");
    writeAws("credentials", "[default]\n");
    expect(listAwsProfiles(home)).toEqual(["default", "dev", "prod"]);
    expect(detectInfrastructurePresence((key) => key === "AWS_PROFILE" ? "work" : null, home)).toMatchObject({ infra: true, awsProfile: "work" });
    expect(detectInfrastructurePresence(() => null, home).awsProfile).toBe("default");
  });
  it("recognises a configured automation folder", () => {
    expect(detectInfrastructurePresence((key) => key === "AUTOMATION_REPO_PATH" ? "/scripts" : null, home)).toMatchObject({ infra: true, scriptsRepoPath: "/scripts" });
  });
  it.each([true, false])("uses enabled plugin declarations (%s)", (enabled) => {
    const plugin = path.join(home, "plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, "devhub-plugin.json"), JSON.stringify({ name: "team-tools", version: "1", devhubApi: "1", contributes: {}, navGate: "infra" }));
    const registry = path.join(home, ".config/devhub/plugins.json");
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(registry, JSON.stringify({ plugins: [{ name: "team-tools", path: plugin, enabled }] }));
    expect(detectInfrastructurePresence(() => null, home).infra).toBe(enabled);
  });
});
