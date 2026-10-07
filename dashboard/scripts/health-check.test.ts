import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DASHBOARD_DIR = path.resolve(__dirname, "..");
const TSX_CLI = path.join(DASHBOARD_DIR, "node_modules/tsx/dist/cli.mjs");
const HEALTH_CHECK = path.join(__dirname, "health-check.ts");

describe("first-run MCP dependency installation", () => {
  let root: string;
  let dashboard: string;
  let server: string;
  let home: string;
  let bin: string;
  let installLog: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-first-run-")));
    dashboard = path.join(root, "dashboard");
    server = path.join(root, "mcp-servers/devhub-server");
    home = path.join(root, "home");
    bin = path.join(root, "bin");
    installLog = path.join(root, "npm-install.log");
    for (const dir of [dashboard, server, home, bin, path.join(root, "notes"), path.join(root, "docs")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(server, "package.json"), "{}");
    fs.writeFileSync(path.join(dashboard, ".env.op-synced"), "test fixture");
    fs.writeFileSync(path.join(dashboard, ".env.local"), [
      `NOTES_DIR=${path.join(root, "notes")}`,
      `DOCS_DIR=${path.join(root, "docs")}`,
      "PORT=65432",
    ].join("\n"));
    fs.writeFileSync(path.join(bin, "npm"), [
      "#!/bin/sh",
      'printf "%s\\n" "$PWD" >> "$DEVHUB_TEST_INSTALL_LOG"',
      'if [ "$DEVHUB_TEST_INSTALL_FAIL" = "1" ]; then exit 1; fi',
      "mkdir -p node_modules",
    ].join("\n"), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runHealthCheck(explicitRoot: boolean, failInstall = false): string {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      DEVHUB_TEST_INSTALL_LOG: installLog,
      DEVHUB_TEST_INSTALL_FAIL: failInstall ? "1" : "0",
      DEVHUB_OP_CACHE: "1",
    };
    for (const key of ["REPO_ROOT", "NOTES_DIR", "DOCS_DIR", "PORT", "DEVHUB_OP_REFRESH", "DEVHUB_OP_CACHE_DIR"]) {
      delete env[key];
    }
    if (explicitRoot) Object.assign(env, { REPO_ROOT: root });
    return execFileSync(process.execPath, [TSX_CLI, "--tsconfig", path.join(DASHBOARD_DIR, "tsconfig.json"), HEALTH_CHECK], {
      cwd: dashboard,
      env,
      encoding: "utf-8",
      timeout: 30_000,
    });
  }

  it.each([true, false])("installs core MCP in the checkout with explicit REPO_ROOT=%s", (explicitRoot) => {
    const output = runHealthCheck(explicitRoot);
    expect(fs.readFileSync(installLog, "utf-8").trim()).toBe(server);
    expect(fs.existsSync(path.join(server, "node_modules"))).toBe(true);
    expect(output).toContain("DevHub ready");
  });

  it("reports a failed MCP install while leaving dashboard startup available", () => {
    const output = runHealthCheck(true, true);
    expect(output).toContain("DevHub MCP server npm install failed");
    expect(fs.existsSync(path.join(server, "node_modules"))).toBe(false);
  });
});
