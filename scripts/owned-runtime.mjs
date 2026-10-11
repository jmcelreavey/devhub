#!/usr/bin/env node
// execExternal launches this as its own process group. Keeping the group leader
// alive lets us kill only our descendants after even an ungraceful parent exit.
import { spawn } from "node:child_process";
const [parentId, binary, ...args] = process.argv.slice(2);
const parent = Number(parentId);
if (!binary || !Number.isSafeInteger(parent) || parent !== process.ppid || process.platform === "win32") process.exit(2);
const child = spawn(binary, args, { stdio: "inherit", detached: false });
function stop() { process.kill(-process.pid, "SIGKILL"); }
const watcher = setInterval(() => { if (process.ppid !== parent) stop(); }, 1000);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("error", () => { clearInterval(watcher); process.stderr.write("Managed runtime could not start.\n"); process.exit(1); });
child.on("exit", () => { clearInterval(watcher); stop(); });
