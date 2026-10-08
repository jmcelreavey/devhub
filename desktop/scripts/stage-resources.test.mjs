import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { stageResources } from "./stage-resources.mjs";
import { resourcesDir } from "./staging-paths.mjs";

test("installed resources contain a runnable pull bootstrap with all local imports", async () => {
  const manifest = stageResources();
  for (const resource of ["scripts/checkout-rebuild.mjs", "scripts/checkout-payload-smoke.mjs", "dashboard/lib/desktop/build-env.mjs"]) {
    assert.equal(manifest.filter((entry) => entry.path === resource).length, 1);
  }
  const bootstrap = await import(pathToFileURL(path.join(resourcesDir, "scripts", "checkout-rebuild.mjs")).href);
  assert.equal(bootstrap.optionsFromArgs(["--launcher=systemd-run", "--pull"]).launcher, "systemd-run");
  assert.equal(typeof bootstrap.runRebuild, "function");
});
