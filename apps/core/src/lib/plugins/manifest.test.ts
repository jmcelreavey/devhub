import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManifest, readManifestDetailed } from "./manifest";

it("rejects dashboard declarations with migration guidance", () => {
  const manifest = { name: "example", version: "1", devhubApi: "1", contributes: {}, dashboard: {} };
  const message = "dashboard is no longer supported; use runtime pages/themes";
  expect(parseManifest(manifest)).toEqual({ ok: false, error: message });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-manifest-"));
  try {
    fs.writeFileSync(path.join(dir, "devhub-plugin.json"), JSON.stringify(manifest));
    expect(readManifestDetailed(dir)).toMatchObject({ ok: false, issues: [{ field: "dashboard", message }] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
