import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

test("finishes killing children when the shell's output pipes close", { skip: process.platform === "win32", timeout: 10_000 }, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "devhub-shutdown-")));
  const services = path.join(root, "services");
  const server = path.join(root, "server");
  fs.mkdirSync(services);
  fs.mkdirSync(server);
  for (const file of ["supervisor.mjs", "managed-tools.mjs"]) {
    fs.copyFileSync(new URL(file, import.meta.url), path.join(services, file));
  }
  fs.writeFileSync(path.join(server, "core-server.mjs"), `
    process.on("SIGTERM", () => {});
    console.log("fixture-child=" + process.pid);
    setInterval(() => {}, 1000);
  `);
  const supervisor = spawn(process.execPath, [path.join(services, "supervisor.mjs")], {
    env: { HOME: root, DEVHUB_APP_DATA: root, DEVHUB_RESOURCE_ROOT: root, DEVHUB_SERVER_DIR: server, PORT: "42100", TERMINAL_PORT: "42101" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(supervisor, "exit");
  let childPid;
  t.after(async () => {
    supervisor.kill("SIGKILL");
    if (childPid) {
      try { process.kill(childPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await exit;
    fs.rmSync(root, { recursive: true, force: true });
  });
  supervisor.stderr.resume();
  childPid = await new Promise((resolve) => {
    let output = "";
    supervisor.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /fixture-child=(\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
  });
  supervisor.stdout.destroy();
  supervisor.stderr.destroy();
  supervisor.kill("SIGTERM");
  assert.equal((await exit)[0], 0);
  for (let attempt = 0; attempt < 20; attempt++) {
    try { process.kill(childPid, 0); } catch (error) {
      assert.equal(error.code, "ESRCH");
      childPid = undefined;
      return;
    }
    await delay(50);
  }
  assert.fail("the supervisor left its SIGTERM-resistant child running");
});
