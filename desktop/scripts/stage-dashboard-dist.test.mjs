import assert from "node:assert/strict";
import test from "node:test";
import { nextDistDir } from "./stage-dashboard.mjs";

test("next build stays on .next unless a rebuild names a sibling dist dir", () => {
  assert.equal(nextDistDir({}), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next" }), ".next");
  assert.equal(nextDistDir({ DEVHUB_DIST_DIR: ".next-rebuild" }), ".next-rebuild");
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "/tmp/elsewhere" }), /DEVHUB_DIST_DIR/);
  assert.throws(() => nextDistDir({ DEVHUB_DIST_DIR: "../.next" }), /DEVHUB_DIST_DIR/);
});
