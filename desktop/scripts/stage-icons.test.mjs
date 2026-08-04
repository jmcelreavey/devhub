import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDesktopIconSource } from "./stage-icons.mjs";

test("prefers the plugin desktop icon when it exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  const plugin = path.join(root, "plugin-desktop-icon.png");
  const fallback = path.join(root, "icon-512.png");
  fs.writeFileSync(plugin, "plugin");
  fs.writeFileSync(fallback, "default");

  const resolved = resolveDesktopIconSource(plugin, fallback);
  assert.equal(resolved.kind, "plugin");
  assert.equal(resolved.source, plugin);
});

test("falls back to the core bottle when no plugin icon is present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  const plugin = path.join(root, "plugin-desktop-icon.png");
  const fallback = path.join(root, "icon-512.png");
  fs.writeFileSync(fallback, "default");

  const resolved = resolveDesktopIconSource(plugin, fallback);
  assert.equal(resolved.kind, "default");
  assert.equal(resolved.source, fallback);
});

test("throws when neither source exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  assert.throws(
    () =>
      resolveDesktopIconSource(
        path.join(root, "missing-plugin.png"),
        path.join(root, "missing-default.png"),
      ),
    /No desktop icon source/,
  );
});
