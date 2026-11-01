import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function dockerArgs(hostOptions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-linux-builder-"));
  try {
    const docker = path.join(root, "docker");
    const argsFile = path.join(root, "args");
    fs.writeFileSync(docker, "#!/bin/sh\nif [ \"$1\" = run ]; then printf \"%s\\n\" \"$@\" > \"$ARGS_FILE\"; fi\n", { mode: 0o755 });
    const env = { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, ARGS_FILE: argsFile };
    if (hostOptions === undefined) delete env.NODE_OPTIONS;
    else env.NODE_OPTIONS = hostOptions;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("build-linux.mjs", import.meta.url))], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(argsFile, "utf8").split("\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Linux builder passes the default or host Node heap options to Docker", { skip: process.platform === "win32" }, () => {
  assert.ok(dockerArgs().includes("NODE_OPTIONS=--max-old-space-size=6144"));
  assert.ok(dockerArgs("--max-old-space-size=4096").includes("NODE_OPTIONS=--max-old-space-size=4096"));
});

test("Linux builder isolates staging and binaries on native Docker volumes", { skip: process.platform === "win32" }, () => {
  const args = dockerArgs();
  for (const directory of ["staging", "src-tauri/binaries"]) {
    assert.ok(args.includes(`type=volume,destination=/work/apps/desktop/${directory},volume-nocopy`));
  }
});
