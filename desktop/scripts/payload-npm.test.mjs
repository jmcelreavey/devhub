import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installPayloadNpmShims, withNodeToolchain } from "../../dashboard/lib/desktop/build-env.mjs";
import { auditPayloadNpm } from "./payload-npm-audit.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devhub-payload-npm-"));
}

/**
 * The runtime directory (dirname of the payload `node`) is what supervisor
 * `repairedPath`, `packagedToolDirs`, and `extraPathSegments` put on PATH.
 * npm and npx must not be executables in that directory.
 */
test("payload npm shims stay out of the runtime directory user-facing PATH includes", () => {
  const root = tempDir();
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime, "node"), "#!/bin/sh\nprintf '%s\\n' \"$1\"\n");
  fs.chmodSync(path.join(runtime, "node"), 0o755);
  const bin = path.join(runtime, "lib", "node_modules", "npm", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "npm-cli.js"), "");
  fs.writeFileSync(path.join(bin, "npx-cli.js"), "");

  const shimDir = installPayloadNpmShims(runtime);
  assert.equal(shimDir, path.join(runtime, "npm-bin"));
  assert.deepEqual(fs.readdirSync(shimDir).sort(), ["npm", "npx"]);
  assert.equal(fs.existsSync(path.join(runtime, "npm")), false);
  assert.equal(fs.existsSync(path.join(runtime, "npx")), false);

  assert.throws(() => execFileSync("npm", ["--version"], { env: { PATH: runtime }, encoding: "utf8" }));

  const userNpm = "/home/me/.nvm/versions/node/v22.22.3/bin";
  const env = withNodeToolchain({ PATH: [userNpm, "/usr/bin"].join(path.delimiter) }, path.join(runtime, "node"));
  const parts = env.PATH.split(path.delimiter);
  assert.equal(parts[0], shimDir);
  assert.equal(parts[1], runtime);
  assert.ok(parts.includes(userNpm));

  const out = execFileSync("npm", ["--version"], { env: { PATH: env.PATH }, encoding: "utf8" });
  assert.match(out, /npm-cli\.js/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("withNodeToolchain leaves a normal Node bin first when npm-bin is absent", () => {
  const env = withNodeToolchain({ PATH: "/usr/bin", HOME: "/home/me" }, "/opt/node22/bin/node", () => false);
  assert.equal(env.PATH, ["/opt/node22/bin", "/usr/bin"].join(path.delimiter));
  assert.equal(env.HOME, "/home/me");
});

function npmShapedTree(dir) {
  fs.mkdirSync(path.join(dir, "node_modules", "node-gyp"), { recursive: true });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# npm\n");
  fs.writeFileSync(path.join(dir, ".npmrc"), "");
  fs.writeFileSync(path.join(dir, "node_modules", "node-gyp", "addon.gypi"), "");
  fs.writeFileSync(path.join(dir, "node_modules", "node-gyp", "binding.gyp"), "");
  fs.writeFileSync(path.join(dir, "bin", "npm-cli.js"), "");
  fs.symlinkSync("../../bin/npm-cli.js", path.join(dir, "node_modules", ".bin", "npm"));
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from("libc.so.6")]);
  fs.writeFileSync(path.join(dir, "node_modules", "glibc.node"), elf);
}

test("markdown, nested node_modules, gyp files, and an in-tree symlink pass the payload npm scan", () => {
  const dir = tempDir();
  npmShapedTree(dir);
  assert.deepEqual(auditPayloadNpm(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a credential-shaped name, a musl binary, and a symlink that leaves the tree fail the payload npm scan", () => {
  const pem = tempDir();
  npmShapedTree(pem);
  fs.mkdirSync(path.join(pem, "certs"), { recursive: true });
  fs.writeFileSync(path.join(pem, "certs", "server.pem"), "x");
  assert.ok(auditPayloadNpm(pem).some((line) => line.includes("server.pem")));
  fs.rmSync(pem, { recursive: true, force: true });

  const musl = tempDir();
  const buf = Buffer.concat([
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from("libc.musl-x86_64.so.1"),
  ]);
  fs.writeFileSync(path.join(musl, "sharp.node"), buf);
  assert.deepEqual(auditPayloadNpm(musl), ["sharp.node (musl)"]);

  const escape = tempDir();
  fs.symlinkSync("/etc/passwd", path.join(escape, "outside"));
  assert.ok(auditPayloadNpm(escape).some((line) => line.includes("escapes")));

  const dangling = tempDir();
  fs.symlinkSync("missing-target", path.join(dangling, "gone"));
  assert.ok(auditPayloadNpm(dangling).some((line) => line.includes("dangling")));

  fs.rmSync(musl, { recursive: true, force: true });
  fs.rmSync(escape, { recursive: true, force: true });
  fs.rmSync(dangling, { recursive: true, force: true });
});
