import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDesktopIconSource, stagePluginSidecar } from "./stage-icons.mjs";

test("bundled OS icon is always the core bottle, even when a plugin icon exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  const plugin = path.join(root, "plugin-desktop-icon.png");
  const fallback = path.join(root, "icon-512.png");
  fs.writeFileSync(plugin, "plugin");
  fs.writeFileSync(fallback, "default");

  const resolved = resolveDesktopIconSource(plugin, fallback);
  assert.equal(resolved.kind, "default");
  assert.equal(resolved.source, fallback);
});

test("throws when the core bottle is missing", () => {
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

test("plugin sidecar copies the plugin PNG when it exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  const plugin = path.join(root, "plugin-desktop-icon.png");
  const dest = path.join(root, "out", "plugin.png");
  fs.writeFileSync(plugin, "plugin-bytes");

  assert.equal(stagePluginSidecar(plugin, dest), "plugin");
  assert.equal(fs.readFileSync(dest, "utf8"), "plugin-bytes");
});

test("plugin sidecar falls back to the bottle when no plugin icon exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-icons-"));
  const dest = path.join(root, "out", "plugin.png");
  const fallback = path.join(root, "icon-512.png");
  fs.writeFileSync(fallback, "bottle");

  assert.equal(
    stagePluginSidecar(path.join(root, "missing.png"), dest, fallback),
    "none",
  );
  assert.equal(fs.readFileSync(dest, "utf8"), "bottle");
});
