import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bundleRootFor,
  rebuildInstalledServer,
  replaceDirContents,
  resolveServicesTarget,
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
  // Older packaged shells only pass DEVHUB_SERVER_DIR. Rebuild Dashboard
  // still has to restage start-peer-services.mjs.
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

test("rebuildInstalledServer copies staged peers, not only the Next server", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-install-"));
  const serverTarget = path.join(root, "Resources", "server");
  const servicesTarget = path.join(root, "Resources", "services");
  fs.mkdirSync(serverTarget, { recursive: true });
  fs.mkdirSync(servicesTarget, { recursive: true });
  fs.writeFileSync(path.join(serverTarget, "server.js"), "stale-server");
  fs.writeFileSync(path.join(servicesTarget, "supervisor.mjs"), "stale-supervisor");
  fs.writeFileSync(path.join(servicesTarget, "start-peer-services.mjs"), "stale-peers");

  const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-rebuild-staged-"));
  const stagedServer = path.join(stagedRoot, "server");
  const stagedServices = path.join(stagedRoot, "services");
  fs.mkdirSync(path.join(stagedServer, ".next", "static"), { recursive: true });
  fs.mkdirSync(stagedServices, { recursive: true });
  fs.writeFileSync(path.join(stagedServer, "server.js"), "fresh-server");
  fs.writeFileSync(path.join(stagedServer, ".next", "static", "app.js"), "ui");
  fs.writeFileSync(path.join(stagedServices, "start-peer-services.mjs"), "fresh-peers");
  fs.writeFileSync(path.join(stagedServices, "supervisor.mjs"), "fresh-supervisor");

  await rebuildInstalledServer({
    serverTarget,
    servicesTarget,
    stagedServer,
    stagedServices,
    async stage() {},
  });

  assert.equal(fs.readFileSync(path.join(serverTarget, "server.js"), "utf8"), "fresh-server");
  assert.equal(
    fs.readFileSync(path.join(servicesTarget, "start-peer-services.mjs"), "utf8"),
    "fresh-peers",
  );
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
    fs.writeFileSync(path.join(root, "server.js"), "fresh-server");
    const alias = root + "-link";
    fs.symlinkSync(root, alias, "dir");
    try {
      replaceDirContents(root, alias);
      assert.equal(fs.readFileSync(path.join(root, "server.js"), "utf8"), "fresh-server");
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
      fs.writeFileSync(path.join(serverTarget, "server.js"), "old-server");
      fs.writeFileSync(path.join(servicesTarget, "supervisor.mjs"), "old-supervisor");
      fs.writeFileSync(path.join(stagedServer, "server.js"), "fresh-server");
      fs.writeFileSync(path.join(stagedServices, "start-peer-services.mjs"), "fresh-peers");
      if (missing !== "static") fs.mkdirSync(path.join(stagedServer, ".next", "static"), { recursive: true });
      if (missing !== "supervisor") fs.writeFileSync(path.join(stagedServices, "supervisor.mjs"), "fresh-supervisor");
      await assert.rejects(rebuildInstalledServer({
        serverTarget, servicesTarget, stagedServer, stagedServices, async stage() {},
      }), /stage-dashboard produced no/);
      assert.equal(fs.readFileSync(path.join(serverTarget, "server.js"), "utf8"), "old-server");
      assert.equal(fs.readFileSync(path.join(servicesTarget, "supervisor.mjs"), "utf8"), "old-supervisor");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
  assert.equal(bundleRootFor("/Users/me/devhub/desktop/staging/server"), null);
});
