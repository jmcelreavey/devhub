import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { applyAionSourcePatches } from "./aionui-apply-source-patches.mjs";
import { csrfBridgeScript } from "./aionui-apply-web-patches.mjs";

test("the CSRF bridge covers fetch and XMLHttpRequest mutations", async () => {
  const fetchCalls = [];
  const window = {
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return { ok: true };
    },
  };

  class FakeXMLHttpRequest {
    headers = new Map();
    headerWrites = 0;

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headerWrites += 1;
      this.headers.set(name.toLowerCase(), value);
    }

    send(body) {
      this.body = body;
    }
  }

  vm.runInNewContext(csrfBridgeScript, {
    document: { cookie: "aionui-csrf-token=csrf-value" },
    Headers,
    window,
    XMLHttpRequest: FakeXMLHttpRequest,
  });

  await window.fetch("/api/settings", { method: "POST" });
  assert.equal(fetchCalls[0].init.headers.get("x-csrf-token"), "csrf-value");

  const upload = new FakeXMLHttpRequest();
  upload.open("POST", "/api/fs/upload");
  upload.send("image");
  assert.equal(upload.headers.get("x-csrf-token"), "csrf-value");

  const alreadyCovered = new FakeXMLHttpRequest();
  alreadyCovered.open("POST", "/api/fs/upload");
  alreadyCovered.setRequestHeader("X-CSRF-Token", "upstream-value");
  alreadyCovered.send("image");
  assert.equal(alreadyCovered.headerWrites, 1);
  assert.equal(alreadyCovered.headers.get("x-csrf-token"), "upstream-value");

  const read = new FakeXMLHttpRequest();
  read.open("GET", "/api/fs/dir");
  read.send();
  assert.equal(read.headers.has("x-csrf-token"), false);
});

test("the source patch gives every project picker the configured starting directory", (context) => {
  const release = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-aionui-patch-"));
  context.after(() => fs.rmSync(release, { recursive: true, force: true }));
  const files = [
    "packages/desktop/src/renderer/components/workspace/WorkspaceFolderSelect.tsx",
    "packages/desktop/src/renderer/hooks/file/useWorkspaceSelector.ts",
    "packages/desktop/src/renderer/pages/conversation/explorer/ExplorerContainer.tsx",
  ];
  const original = "const files = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });\n";

  for (const relativePath of files) {
    const file = path.join(release, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);
  }

  const first = applyAionSourcePatches(release, "/Users/example/Developer");
  const second = applyAionSourcePatches(release, "/Users/example/Developer");

  assert.equal(first.patched.length, 3);
  assert.equal(second.patched.length, 0);
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(release, relativePath), "utf8");
    assert.match(source, /defaultPath: "\/Users\/example\/Developer"/);
  }
});
