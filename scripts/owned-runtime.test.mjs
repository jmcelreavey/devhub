import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const runtime = fileURLToPath(new URL("./owned-runtime.mjs", import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
test("owned runtime kills its descendants after the launching process crashes", { skip: process.platform === "win32", timeout: 10000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owned-runtime-"));
  const file = path.join(dir, "child");
  const command = `const {spawn}=require('node:child_process');spawn(process.execPath,[${JSON.stringify(runtime)},String(process.pid),process.execPath,'-e',${JSON.stringify("require('node:fs').writeFileSync(" + JSON.stringify(file) + ",String(process.pid));setInterval(()=>{},1000)")}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["-e", command], { stdio: "ignore" });
  let child;
  try {
    for (let i = 0; i < 100 && !fs.existsSync(file); i++) await delay(25);
    assert.ok(fs.existsSync(file), "child started");
    child = Number(fs.readFileSync(file, "utf8"));
    assert.ok(alive(child));
    parent.kill("SIGKILL");
    for (let i = 0; i < 100 && alive(child); i++) await delay(25);
    assert.equal(alive(child), false);
  } finally {
    parent.kill("SIGKILL");
    if (child && alive(child)) process.kill(child, "SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
