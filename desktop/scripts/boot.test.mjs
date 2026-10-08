import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("the busy-port dialog labels the wait and pauses the boot counter", () => {
  const html = fs.readFileSync(new URL("../boot/index.html", import.meta.url), "utf8");
  const labels = html.match(/const SERVICE_LABEL = \{[\s\S]*?\n      \};/)?.[0];
  const clock = html.match(/const startedAt = Date.now\(\);[\s\S]*?const elapsedSeconds = \(\) => \{[\s\S]*?\n      \};/)?.[0];
  assert.ok(labels);
  assert.ok(clock);
  let now = 0;
  const boot = vm.runInNewContext(`${labels}\n${clock}\n({ SERVICE_LABEL, notePause, elapsedSeconds })`, { Date: { now: () => now } });
  assert.equal(boot.SERVICE_LABEL["wsl-wait"], "Waiting for you to choose what to do about the busy port…");
  now = 5000;
  boot.notePause("wsl-wait");
  now = 65000;
  assert.equal(boot.elapsedSeconds(), 5);
  boot.notePause("wsl");
  now = 67000;
  assert.equal(boot.elapsedSeconds(), 7);
});
