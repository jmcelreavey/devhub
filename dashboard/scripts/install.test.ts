import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const INSTALL_SCRIPT = path.resolve(__dirname, "../../scripts/install.sh");

describe("full installer exit status", () => {
  let root: string;
  let bin: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-install-"));
    bin = path.join(root, "bin");
    for (const dir of [bin, path.join(root, "scripts"), path.join(root, "dashboard")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(INSTALL_SCRIPT, path.join(root, "scripts/install.sh"));
    fs.writeFileSync(path.join(root, "dashboard/package.json"), "{}");
    for (const command of ["npm", "safe-chain"]) {
      fs.writeFileSync(path.join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    fs.writeFileSync(path.join(bin, "npx"), '#!/bin/sh\nexit "$DEVHUB_TEST_BOOTSTRAP_STATUS"\n', { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function install(bootstrapStatus: number): { status: number; output: string } {
    try {
      const output = execFileSync("bash", [path.join(root, "scripts/install.sh")], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          DEVHUB_TEST_BOOTSTRAP_STATUS: String(bootstrapStatus),
        },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
  }

  it("fails without claiming completion when bootstrap fails", () => {
    const result = install(9);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Bootstrap failed");
    expect(result.output).not.toContain("Installation Complete");
  });

  it("reports completion after a successful bootstrap", () => {
    const result = install(0);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Installation Complete");
  });
});
