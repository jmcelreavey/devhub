import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appCommand(command, bundle, appExecutable) {
  const executable = `${bundle}/Contents/MacOS/${appExecutable}`;
  return command === executable || command.startsWith(`${executable} `);
}

function serverCommand(command, bundle) {
  const resources = `${bundle}/Contents/Resources`;
  const node = new RegExp(`^${escapeRegex(resources)}/runtime/node(?:-[a-zA-Z0-9_.-]+)?\\s`);
  if (!node.test(command)) return false;
  const entries = [
    `${resources}/server/core-server.mjs`,
    `${resources}/services/supervisor.mjs`,
    `${resources}/services/terminal-pty-server.cjs`,
  ];
  const args = command.replace(node, "");
  if (entries.some((entry) => args === entry || args.startsWith(`${entry} `))) return true;
  // Match the two processes tsx starts, not a server path passed to another script.
  const mcp = /^(?:--require )?(.+)\/node_modules\/tsx\/dist\/(?:cli\.mjs|preflight\.cjs) /.exec(args);
  if (!mcp) return false;
  const tsx = `${mcp[1]}/node_modules/tsx/dist`;
  const entry = `${mcp[1]}/packages/mcp/src/http.ts`;
  return args === `${tsx}/cli.mjs ${entry}` ||
    args === `--require ${tsx}/preflight.cjs --import ${pathToFileURL(`${tsx}/loader.mjs`).href} ${entry}`;
}

function orphaned(row, rows, bundle) {
  const byPid = new Map(rows.map((entry) => [entry.pid, entry]));
  const seen = new Set([row.pid]);
  let parent = row.ppid;
  while (parent > 1 && !seen.has(parent)) {
    seen.add(parent);
    const entry = byPid.get(parent);
    if (!entry || !serverCommand(entry.command, bundle)) return false;
    parent = entry.ppid;
  }
  return parent === 1;
}

function listProcesses() {
  const output = execFileSync("/bin/ps", ["-xww", "-o", "pid=,ppid=,command="], {
    encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024,
  });
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
  });
}

async function stopMatching(matches, { list, signal, sleep }) {
  const snapshot = list();
  const original = snapshot.filter((row) => matches(row, snapshot));
  const remaining = () => {
    const rows = list();
    return original.filter((target) => rows.some((row) =>
      row.pid === target.pid && row.command === target.command && matches(row, rows)));
  };
  const signalRemaining = (name) => {
    for (const target of original) {
      if (remaining().some((row) => row.pid === target.pid)) signal(target.pid, name);
    }
  };
  signalRemaining("SIGTERM");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (remaining().length === 0) return;
    await sleep(100);
  }
  signalRemaining("SIGKILL");
  for (let attempt = 0; attempt < 20; attempt++) {
    if (remaining().length === 0) return;
    await sleep(100);
  }
  if (remaining().length) throw new Error("Could not stop the previous DevHub processes");
}

export async function cleanupOrphans(bundle, { stopApp = false, appExecutable = "devhub-desktop", list = listProcesses,
  signal = (pid, name) => {
    try { process.kill(pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const operations = { list, signal, sleep };
  if (stopApp) {
    if (!appExecutable || appExecutable === "." || appExecutable === ".." || path.basename(appExecutable) !== appExecutable) {
      throw new Error("Invalid DevHub executable name");
    }
    await stopMatching((row) => appCommand(row.command, bundle, appExecutable), operations);
  }
  await stopMatching((row, rows) => serverCommand(row.command, bundle) && orphaned(row, rows, bundle), operations);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cleanupOrphans(process.argv[2]);
}
