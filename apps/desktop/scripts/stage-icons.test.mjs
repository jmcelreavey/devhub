import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDesktopIconSource } from "./stage-icons.mjs";

test("bundled OS icon stays the core mark when a plugin icon exists", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plugin = path.join(root, "plugin-desktop-icon.png");
  const fallback = path.join(root, "icon-512.png");
  fs.writeFileSync(plugin, "plugin");
  fs.writeFileSync(fallback, "default");

  const resolved = resolveDesktopIconSource(plugin, fallback);
  assert.equal(resolved.kind, "default");
  assert.equal(resolved.source, fallback);
});
