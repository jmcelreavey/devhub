import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { archiveFiles } from "./stage-dashboard.mjs";

import {
  bundleRootFor,
  rebuildInstalledServer,
  replaceDirContents,
  resolveServicesTarget,
  stageCoreDashboard,
} from "./rebuild-installed-server.mjs";

test("resolveServicesTarget prefers DEVHUB_SERVICES_DIR", () => {
  assert.equal(
    resolveServicesTarget("/app/Resources/server", {
      DEVHUB_SERVICES_DIR: "/app/Resources/services",
    }),
    "/app/Resources/services",
  );
});

test("resolveServicesTarget falls back to the sibling of the server tree", () => {
  // Older packaged shells only pass DEVHUB_SERVER_DIR.
  assert.equal(
    resolveServicesTarget("/Applications/DevHub.app/Contents/Resources/server", {}),
    "/Applications/DevHub.app/Contents/Resources/services",
  );
});

test("resolveServicesTarget rejects a relative DEVHUB_SERVICES_DIR", () => {
  assert.throws(
    () => resolveServicesTarget("/app/Resources/server", { DEVHUB_SERVICES_DIR: "services" }),
    /must be absolute/,
  );
});

test("replaceDirContents swaps children and keeps the destination directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-"));
  const from = path.join(root, "from");
  const to = path.join(root, "to");
  fs.mkdirSync(path.join(from, "nested"), { recursive: true });
  fs.writeFileSync(path.join(from, "nested", "fresh.txt"), "new");
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, "stale.txt"), "old");
  const inode = fs.statSync(to).ino;

  replaceDirContents(from, to);

  assert.equal(fs.statSync(to).ino, inode);
  assert.equal(fs.existsSync(path.join(to, "stale.txt")), false);
  assert.equal(fs.readFileSync(path.join(to, "nested", "fresh.txt"), "utf8"), "new");
  fs.rmSync(root, { recursive: true, force: true });
});

test("rebuildInstalledServer copies staged services with the core server", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-install-"));
  const serverTarget = path.join(root, "Resources", "server");
  const servicesTarget = path.join(root, "Resources", "services");
  fs.mkdirSync(serverTarget, { recursive: true });
  fs.mkdirSync(servicesTarget, { recursive: true });
  fs.writeFileSync(path.join(serverTarget, "core-server.mjs"), "stale-server");
  fs.writeFileSync(path.join(servicesTarget, "supervisor.mjs"), "stale-supervisor");

  const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-staged-"));
  const stagedServer = path.join(stagedRoot, "server");
  const stagedServices = path.join(stagedRoot, "services");
  fs.mkdirSync(path.join(stagedServer, "ui", "dist"), { recursive: true });
  fs.mkdirSync(stagedServices, { recursive: true });
  fs.writeFileSync(path.join(stagedServer, "core-server.mjs"), "fresh-server");
  fs.writeFileSync(path.join(stagedServer, "ui", "dist", "index.html"), "ui");
  fs.writeFileSync(path.join(stagedServices, "supervisor.mjs"), "fresh-supervisor");

  await rebuildInstalledServer({
    serverTarget,
    servicesTarget,
    stagedServer,
    stagedServices,
    async stage() {},
  });

  assert.equal(fs.readFileSync(path.join(serverTarget, "core-server.mjs"), "utf8"), "fresh-server");
  const retained = fs.readdirSync(path.dirname(serverTarget)).find((name) => name.startsWith(".server-rebuild-"));
  assert.ok(retained);
  assert.equal(fs.readFileSync(path.join(path.dirname(serverTarget), retained, "backup", "core-server.mjs"), "utf8"), "stale-server");
  assert.equal(
    fs.readFileSync(path.join(servicesTarget, "supervisor.mjs"), "utf8"),
    "fresh-supervisor",
  );

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(stagedRoot, { recursive: true, force: true });
});

test("replaceDirContents keeps a staging tree used directly by desktop:dev", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-same-"));
  try {
    fs.writeFileSync(path.join(root, "core-server.mjs"), "fresh-server");
    const alias = root + "-link";
    fs.symlinkSync(root, alias, "dir");
    try {
      replaceDirContents(root, alias);
      assert.equal(fs.readFileSync(path.join(root, "core-server.mjs"), "utf8"), "fresh-server");
    } finally { fs.unlinkSync(alias); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const missing of ["static", "supervisor"]) {
  test(`an incomplete staged ${missing} leaves the installed server untouched`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-invalid-"));
    const serverTarget = path.join(root, "installed", "server");
    const servicesTarget = path.join(root, "installed", "services");
    const stagedServer = path.join(root, "staged", "server");
    const stagedServices = path.join(root, "staged", "services");
    try {
      for (const dir of [serverTarget, servicesTarget, stagedServer, stagedServices]) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(serverTarget, "core-server.mjs"), "old-server");
      fs.writeFileSync(path.join(servicesTarget, "supervisor.mjs"), "old-supervisor");
      fs.writeFileSync(path.join(stagedServer, "core-server.mjs"), "fresh-server");
      if (missing !== "static") writeFixture(path.join(stagedServer, "ui", "dist", "index.html"), "ui");
      if (missing !== "supervisor") fs.writeFileSync(path.join(stagedServices, "supervisor.mjs"), "fresh-supervisor");
      await assert.rejects(rebuildInstalledServer({
        serverTarget, servicesTarget, stagedServer, stagedServices, async stage() {},
      }), /stage-dashboard produced no/);
      assert.equal(fs.readFileSync(path.join(serverTarget, "core-server.mjs"), "utf8"), "old-server");
      assert.equal(fs.readFileSync(path.join(servicesTarget, "supervisor.mjs"), "utf8"), "old-supervisor");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

for (const failure of ["copy", "replacement", "rollback"]) {
  test(`a failed ${failure} preserves installed data`, async (testContext) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-copy-failure-"));
    testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const serverTarget = path.join(root, "installed/server");
    const servicesTarget = path.join(root, "installed/services");
    const resourcesTarget = path.join(root, "installed/resources");
    const stagedServer = path.join(root, "staged/server");
    const stagedServices = path.join(root, "staged/services");
    const stagedResources = path.join(root, "staged/resources");
    writeFixture(path.join(serverTarget, "core-server.mjs"), "old server");
    writeFixture(path.join(servicesTarget, "supervisor.mjs"), "old supervisor");
    writeFixture(path.join(servicesTarget, "managed-tools.mjs"), "old tools");
    writeFixture(path.join(resourcesTarget, "MANIFEST.json"), "old resources");
    writeFixture(path.join(stagedServer, "core-server.mjs"), "new server");
    writeFixture(path.join(stagedServer, "ui/dist/index.html"), "new static");
    writeFixture(path.join(stagedServices, "supervisor.mjs"), "new supervisor");
    writeFixture(path.join(stagedServices, "managed-tools.mjs"), "new tools");
    writeFixture(path.join(stagedResources, "MANIFEST.json"), "new resources");
    if (failure === "copy") {
      const copy = fs.cpSync;
      testContext.mock.method(fs, "cpSync", (from, to, options) => {
        if (from === stagedServices) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        return copy(from, to, options);
      });
    } else {
      const rename = fs.renameSync;
      let failed = false;
      testContext.mock.method(fs, "renameSync", (from, to) => {
        if ((!failed || failure === "rollback") && to === path.join(servicesTarget, "supervisor.mjs")) {
          failed = true;
          throw Object.assign(new Error("replacement denied"), { code: "EACCES" });
        }
        return rename(from, to);
      });
    }

    await assert.rejects(rebuildInstalledServer({
      serverTarget, servicesTarget, stagedServer, stagedServices, stagedResources,
      async stage() {}, async stageRes() {},
    }), failure === "rollback"
      ? { name: "AggregateError", message: /backups retained/ }
      : { code: failure === "copy" ? "ENOSPC" : "EACCES" });

    assert.equal(fs.readFileSync(path.join(serverTarget, "core-server.mjs"), "utf8"), "old server");
    assert.equal(fs.readFileSync(path.join(servicesTarget, "managed-tools.mjs"), "utf8"), "old tools");
    assert.equal(fs.readFileSync(path.join(resourcesTarget, "MANIFEST.json"), "utf8"), "old resources");
    const installed = fs.readdirSync(path.join(root, "installed")).sort();
    if (failure === "rollback") {
      const backups = installed.filter((name) => name.startsWith(".services-rebuild-"));
      assert.equal(backups.length, 1);
      assert.equal(fs.readFileSync(path.join(root, "installed", backups[0], "backup/supervisor.mjs"), "utf8"), "old supervisor");
    } else {
      assert.equal(fs.readFileSync(path.join(servicesTarget, "supervisor.mjs"), "utf8"), "old supervisor");
      assert.deepEqual(installed, ["resources", "server", "services"]);
    }
  });
}

test("bundleRootFor finds the .app that owns the server tree", () => {
  assert.equal(
    bundleRootFor("/Applications/DevHub.app/Contents/Resources/server"),
    "/Applications/DevHub.app",
  );
});

test("bundleRootFor returns null outside a bundle", () => {
  // desktop:dev restages into the checkout's staging dir. There is no seal to
  // repair there, and signing a bare directory would fail.
  assert.equal(bundleRootFor("/Users/me/devhub/apps/desktop/staging/server"), null);
});


function writeFixture(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

test("a legacy installed release is never replaced in place", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-legacy-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFixture(path.join(root, "server.js"), "old release");
  let staged = false;
  await assert.rejects(rebuildInstalledServer({ serverTarget: root, stage: async () => { staged = true; } }), /Legacy installed releases/);
  assert.equal(staged, false);
  assert.equal(fs.readFileSync(path.join(root, "server.js"), "utf8"), "old release");
});


test("npm archive provenance rejects altered and escaping entries", (context) => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-archive-"));
  context.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  const entry = (name, body, kind = "0") => {
    const bytes = Buffer.from(body);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    header.write(kind, 156, 1, "ascii");
    return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
  };
  const cached = (entries) => {
    const compressed = gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
    const digest = crypto.createHash("sha512").update(compressed).digest();
    const hex = digest.toString("hex");
    const file = path.join(cache, "_cacache/content-v2/sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, compressed);
    return { file, integrity: `sha512-${digest.toString("base64")}` };
  };
  const good = cached([entry("package/lib/main.js", "trusted")]);
  assert.equal(archiveFiles(good.integrity, cache).get("lib/main.js"), crypto.createHash("sha256").update("trusted").digest("hex"));
  const typesRoot = cached([entry("node/index.d.ts", "types"), entry("node/./index.d.ts", "types")]);
  assert.ok(archiveFiles(typesRoot.integrity, cache).has("index.d.ts"));
  fs.writeFileSync(good.file, "changed archive");
  assert.throws(() => archiveFiles(good.integrity, cache), /Corrupt npm cache/);
  const escaping = cached([entry("package/../secret", "outside")]);
  assert.throws(() => archiveFiles(escaping.integrity, cache), /Unsafe npm archive path/);
  const duplicate = cached([entry("package/a", "one"), entry("package/a", "two")]);
  assert.throws(() => archiveFiles(duplicate.integrity, cache), /Duplicate npm archive entry/);
});

test("stageCoreDashboard stages from a real path when the temp root is a symlink", async (context) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebuild-symlink-")));
  context.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "source"), realTemp = path.join(base, "real-tmp"), linkTemp = path.join(base, "link-tmp");
  fs.mkdirSync(path.join(source, "apps/desktop/scripts"), { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), "{}\n");
  fs.mkdirSync(realTemp);
  fs.symlinkSync(realTemp, linkTemp);
  const git = (...args) => execFileSync("git", args, { cwd: source, stdio: "ignore" });
  git("init", "-q"); git("add", "-A"); git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  let seen;
  const staged = await stageCoreDashboard({ sourceRoot: source, toolsRoot: path.resolve(import.meta.dirname, "../../.."), temporaryRoot: linkTemp, stage: async ({ checkout }) => { seen = checkout; } });
  try {
    assert.ok(seen.startsWith(realTemp + path.sep), `checkout ${seen} should be under ${realTemp}`);
    assert.equal(fs.realpathSync(seen), seen);
  } finally { staged.dispose(); }
});
