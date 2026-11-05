import { expect, it } from "vitest";
import { codexUpdateCommand, npmInstallCommand, paseoAutoUpdateTarget } from "./agent-cli-updates";

it("self-updates a standalone Codex through its own command", () => {
  expect(codexUpdateCommand("/home/john/.codex/packages/standalone/current/bin/codex")).toEqual({
    label: "Codex",
    bin: "/home/john/.codex/packages/standalone/current/bin/codex",
    args: ["update"],
  });
});

it("updates an npm Codex through plain node npm-cli.js", () => {
  const existsSync = (file: string) => file === "/toolchain/lib/node_modules/npm/bin/npm-cli.js";
  expect(codexUpdateCommand("/usr/lib/node_modules/@openai/codex/bin/codex", "/toolchain/bin/node", existsSync)).toEqual({
    label: "Codex",
    bin: "/toolchain/bin/node",
    args: ["/toolchain/lib/node_modules/npm/bin/npm-cli.js", "install", "-g", "@openai/codex"],
  });
  expect(codexUpdateCommand("/usr/lib/node_modules/@openai/codex/bin/codex", "/toolchain/bin/node", () => false)).toBeNull();
});

it("leaves an unrecognized Codex layout alone", () => {
  expect(codexUpdateCommand("/opt/vendor/bin/codex")).toBeNull();
});

it("runs npm updates as plain node npm-cli.js, never through a shimmed npm name", () => {
  const existsSync = (file: string) => file === "/toolchain/lib/node_modules/npm/bin/npm-cli.js";
  expect(npmInstallCommand("Gemini", "@google/gemini-cli", "/toolchain/bin/node", existsSync)).toEqual({
    label: "Gemini",
    bin: "/toolchain/bin/node",
    args: ["/toolchain/lib/node_modules/npm/bin/npm-cli.js", "install", "-g", "@google/gemini-cli"],
  });
});

it("drops the npm update when the toolchain ships no npm", () => {
  expect(npmInstallCommand("Gemini", "@google/gemini-cli", "/toolchain/bin/node", () => false)).toBeNull();
});

it("targets an eligible Paseo release and nothing else", () => {
  expect(paseoAutoUpdateTarget({ canUpdate: true, installable: "0.15.0" })).toBe("0.15.0");
  expect(paseoAutoUpdateTarget({ canUpdate: false, installable: "0.15.0" })).toBeNull();
  expect(paseoAutoUpdateTarget({ canUpdate: true, installable: undefined })).toBeNull();
  expect(paseoAutoUpdateTarget({})).toBeNull();
});
