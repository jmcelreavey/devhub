import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pluginContext } from "./context";
import { confirmOperation, prepareLocal, startLifecycle } from "./operations";
import { readManifest } from "./manifest";
import { loadRuntime } from "./runtime-host";
import { runtimeSchema, runtimeInventory } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { authorizePageAction, createPageNote } from "./runtime-pages";
import { pageActionSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-page-contract";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-pages-")));
  roots.push(root);
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  const source = path.join(root, "source");
  fs.cpSync(path.resolve("../../templates/runtime-plugin"), source, { recursive: true });
  const manifest = readManifest(source);
  if (!manifest.ok || !manifest.manifest.runtime) throw new Error("Invalid fixture");
  const runtime = manifest.manifest.runtime;
  runtime.pages = [
    { path: "/review", label: "Review", browser: { preferences: ["devhub:fixture"], clipboard: true, externalLinks: true, navigation: ["/meeting"], createNote: "meetings" } },
    { path: "/meeting", label: "Meeting" },
  ];
  fs.writeFileSync(path.join(source, "devhub-plugin.json"), JSON.stringify(manifest.manifest));
  const ctx = pluginContext({ home: root, repoRoot: root, env: { NODE_ENV: "test", NOTES_DIR: path.join(root, "notes"), DEVHUB_CONFIG_DIR: path.join(root, "config"), DEVHUB_PLUGIN_HOME: path.join(root, "managed"), DEVHUB_PLUGIN_TARGET_HOME: path.join(root, "targets") } });
  const preview = await prepareLocal(ctx, source);
  if (!preview.preview) throw new Error("No review");
  expect(preview.preview.canApply).toBe(true);
  await confirmOperation(ctx, preview.id, { accepted: true, revision: preview.preview.revision, planDigest: preview.preview.planDigest, selectedTargets: [] });
  const input = { page: "/review", revision: loadRuntime(ctx, "sample-tools").revision, action: { kind: "clipboard", text: "Fixture export" } };
  return { root, ctx, input, runtime };
}

it("reviews exact browser grants and rejects unknown fields, navigation and unsafe URLs", async () => {
  const { ctx, input, runtime } = await fixture();
  expect(runtimeInventory(runtime).find(group => group.kind === "Page browser access")?.entries[0]).toContain("devhub:fixture");
  expect(authorizePageAction(ctx, "sample-tools", input).action.kind).toBe("clipboard");
  for (const action of [
    { kind: "preference", key: "devhub:other" }, { kind: "navigate", path: "/setup" },
    { kind: "external", href: "javascript:alert(1)" }, { kind: "external", href: "https://user:password@example.com" },
    { kind: "clipboard", text: "x", command: "forged" }, { kind: "createNote", markdown: "x", expectedModified: "forged" },
  ]) expect(() => authorizePageAction(ctx, "sample-tools", { ...input, action })).toThrow();
  expect(() => authorizePageAction(ctx, "sample-tools", { ...input, page: "/meeting" })).toThrow();
  expect(runtimeSchema.safeParse({ ...runtime, pages: [{ path: "/review", label: "Review", browser: { navigation: ["/setup"] } }] }).success).toBe(false);
  expect(runtimeSchema.safeParse({ ...runtime, pages: [{ path: "/review", label: "Review", browser: { preferences: ["auth-token"] } }] }).success).toBe(false);
  expect(pageActionSchema.safeParse({ kind: "preference", key: "devhub:fixture", value: "x".repeat(32001) }).success).toBe(false);
});

it("rechecks revision, enabled state and page grants at the final authority boundary", async () => {
  const { ctx, input } = await fixture();
  expect(() => authorizePageAction(ctx, "sample-tools", { ...input, revision: "0".repeat(64) })).toThrow();
  const disable = await startLifecycle(ctx, "sample-tools", "disable");
  if (!disable.preview) throw new Error("No disable preview");
  await confirmOperation(ctx, disable.id, { accepted: true, revision: disable.preview.revision, planDigest: disable.preview.planDigest, selectedTargets: [] });
  expect(() => authorizePageAction(ctx, "sample-tools", input)).toThrow();
});

it("creates only today's declared note and keeps existing bytes on retries and forged writes", async () => {
  const { ctx, input, root } = await fixture();
  const request = { ...input, action: { kind: "createNote", markdown: "# Meeting\n\nRetain this content", expectedModified: null } };
  const today = new Date().toISOString().slice(0, 10);
  expect(await createPageNote(ctx, "sample-tools", request)).toEqual({ href: `/notes/meetings/${today}` });
  const file = path.join(root, "notes", "meetings", `${today}.json`);
  const original = fs.readFileSync(file);
  await expect(createPageNote(ctx, "sample-tools", { ...request, action: { ...request.action, markdown: "overwrite" } })).rejects.toThrow(expect.objectContaining({ status: 409, code: "NOTE_EXISTS" }));
  await expect(createPageNote(ctx, "sample-tools", { ...request, action: { ...request.action, path: "../foreign" } })).rejects.toThrow();
  expect(fs.readFileSync(file)).toEqual(original);
});
