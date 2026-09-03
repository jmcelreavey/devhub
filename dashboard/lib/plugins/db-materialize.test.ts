import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGeneratedDbProvidersTs,
  collectPluginDbProviders,
} from "./db-materialize";
import type { PluginManifest, RegisteredPlugin } from "./types";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-db-materialize-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function plugin(
  name: string,
  dashboard: PluginManifest["dashboard"],
  opts: { createFile?: string } = {},
): RegisteredPlugin {
  const root = path.join(tmp, name);
  if (opts.createFile) {
    const file = path.join(root, dashboard?.root ?? "dashboard", opts.createFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export default {};\n");
  }
  return {
    name,
    path: root,
    enabled: true,
    manifest: {
      name,
      version: "1.0.0",
      devhubApi: "1",
      contributes: {},
      dashboard,
    },
  };
}

describe("collectPluginDbProviders", () => {
  it("collects a well-formed provider", () => {
    const p = plugin(
      "bi",
      { root: "dashboard", paths: ["lib/bi-db-provider.ts"], connections: "lib/bi-db-provider.ts" },
      { createFile: "lib/bi-db-provider.ts" },
    );
    const { providers, errors } = collectPluginDbProviders([p]);
    expect(errors).toEqual([]);
    expect(providers).toEqual([
      {
        plugin: "bi",
        modulePath: "lib/bi-db-provider.ts",
        specifier: "./bi-db-provider",
        binding: "biDbProvider",
      },
    ]);
  });

  it("ignores plugins that declare no connections", () => {
    const p = plugin("bi", { root: "dashboard", paths: ["app/ops"] });
    expect(collectPluginDbProviders([p]).providers).toEqual([]);
  });

  /**
   * The generated file lives in `lib/`, so a module anywhere else has no stable
   * relative specifier.
   */
  it("rejects a module outside lib/", () => {
    const p = plugin(
      "bi",
      { root: "dashboard", paths: ["components/db-provider.ts"], connections: "components/db-provider.ts" },
      { createFile: "components/db-provider.ts" },
    );
    expect(collectPluginDbProviders([p]).errors[0]).toMatch(/must be under lib\//);
  });

  /**
   * The whole failure mode this check exists for: the generated file imports a
   * module that was never copied into core, and the *build* fails rather than
   * one page. Catching it here turns that into one legible line.
   */
  it("rejects a module that dashboard.paths would never materialise", () => {
    const p = plugin(
      "bi",
      { root: "dashboard", paths: ["app/ops"], connections: "lib/bi-db-provider.ts" },
      { createFile: "lib/bi-db-provider.ts" },
    );
    expect(collectPluginDbProviders([p]).errors[0]).toMatch(/not covered by dashboard\.paths/);
  });

  it("accepts a module covered by a directory path", () => {
    const p = plugin(
      "bi",
      { root: "dashboard", paths: ["lib/bi"], connections: "lib/bi/provider.ts" },
      { createFile: "lib/bi/provider.ts" },
    );
    expect(collectPluginDbProviders([p]).errors).toEqual([]);
  });

  it("rejects a module that does not exist in the plugin", () => {
    const p = plugin("bi", {
      root: "dashboard",
      paths: ["lib/bi-db-provider.ts"],
      connections: "lib/bi-db-provider.ts",
    });
    expect(collectPluginDbProviders([p]).errors[0]).toMatch(/file not found/);
  });

  it("requires dashboard.root", () => {
    const p: RegisteredPlugin = {
      name: "bi",
      path: tmp,
      enabled: true,
      manifest: {
        name: "bi",
        version: "1",
        devhubApi: "1",
        contributes: {},
        // `root` is required by the schema; this is the hand-built case.
        dashboard: { paths: ["lib/x.ts"], connections: "lib/x.ts" } as PluginManifest["dashboard"],
      },
    };
    expect(collectPluginDbProviders([p]).errors[0]).toMatch(/needs dashboard\.root/);
  });
});

describe("buildGeneratedDbProvidersTs", () => {
  it("emits the empty baseline when nothing is contributed", () => {
    const out = buildGeneratedDbProvidersTs([]);
    expect(out).toContain("Empty baseline");
    expect(out).toContain("PLUGIN_DB_PROVIDERS: DbConnectionProvider[] = []");
  });

  it("emits an import and an entry per provider", () => {
    const out = buildGeneratedDbProvidersTs([
      { plugin: "bi", modulePath: "lib/a.ts", specifier: "./a", binding: "biDbProvider" },
      { plugin: "acme-corp", modulePath: "lib/b.ts", specifier: "./b", binding: "acmeCorpDbProvider" },
    ]);
    expect(out).toContain('import biDbProvider from "./a";');
    expect(out).toContain('import acmeCorpDbProvider from "./b";');
    expect(out).toContain("  biDbProvider,");
    expect(out).toContain("  acmeCorpDbProvider,");
    expect(out).toContain("GENERATED from plugin connections (bi, acme-corp)");
  });
});
