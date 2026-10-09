import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { prepareManagedTools } from "../sidecar/managed-tools.mjs";
import { downloadVerified } from "./stage-node-runtime.mjs";

test("Node download verifies pinned bytes before writing, and rejects offline or changed bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-node-"));
  try {
    const bytes = Buffer.from("pinned fixture");
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const dest = path.join(root, "node.tar.gz");
    await downloadVerified("https://example.invalid/node", dest, hash, async () => new Response(bytes));
    assert.deepEqual(fs.readFileSync(dest), bytes);
    await assert.rejects(downloadVerified("https://example.invalid/node", dest, hash, async () => new Response("changed")), /checksum/);
    assert.deepEqual(fs.readFileSync(dest), bytes);
    await assert.rejects(downloadVerified("https://example.invalid/node", dest, hash, async () => { throw new Error("offline"); }), /offline/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const platform of ["darwin", "linux"]) test(`private tools resolve the bundled runtime on ${platform}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-tools-"));
  try {
    const node = path.join(root, "signed app's runtime", "node");
    const npm = path.join(path.dirname(node), platform === "linux" ? "lib/node_modules/npm/bin" : "npm/bin");
    fs.mkdirSync(npm, { recursive: true });
    fs.symlinkSync(process.execPath, node);
    for (const name of ["npm", "npx"]) fs.writeFileSync(path.join(npm, `${name}-cli.js`), "process.stdout.write(JSON.stringify({node:process.execPath,args:process.argv.slice(2)}));");
    const dataDir = path.join(root, "data");
    const bin = prepareManagedTools({ node, dataDir, platform });
    assert.equal(fs.realpathSync(path.join(bin, "node")), fs.realpathSync(node));
    assert.match(fs.readFileSync(path.join(bin, "npm"), "utf8"), /exec .*npm-cli\.js.*"\$@"/);
    for (const name of ["npm", "npx"]) {
      const output = execFileSync(path.join(bin, name), ["argument with spaces"], { env: { PATH: "/no-system-node" }, encoding: "utf8" });
      assert.deepEqual(JSON.parse(output), { node: fs.realpathSync(process.execPath), args: ["argument with spaces"] });
    }
    assert.equal(prepareManagedTools({ node, dataDir, platform }), bin);
    fs.rmSync(path.join(npm, "npm-cli.js"));
    assert.throws(() => prepareManagedTools({ node, dataDir, platform }), /Bundled tools/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
