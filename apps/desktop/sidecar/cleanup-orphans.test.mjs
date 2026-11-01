import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupOrphans } from "./cleanup-orphans.mjs";

const bundle = "/test/DevHub.app";
const runtime = `${bundle}/Contents/Resources/runtime/node-aarch64-apple-darwin`;

test("stops orphaned bundled servers, escalating only while their identity still matches", async () => {
  let rows = [
    { pid: 100, ppid: 1, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` },
    { pid: 101, ppid: 1, command: `${runtime} /checkout/node_modules/tsx/dist/cli.mjs /checkout/packages/mcp/src/http.ts` },
  ];
  const signals = [];
  await cleanupOrphans(bundle, {
    list: () => rows,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 101 || signal === "SIGKILL") rows = rows.filter((row) => row.pid !== pid);
    },
    sleep: async () => {},
  });
  assert.deepEqual(signals, [[100, "SIGTERM"], [101, "SIGTERM"], [100, "SIGKILL"]]);

  rows = [{ pid: 100, ppid: 1, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` }];
  signals.length = 0;
  await cleanupOrphans(bundle, {
    list: () => rows,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      rows = [{ pid, ppid: 1, command: "/usr/bin/node unrelated.js" }];
    },
    sleep: async () => {},
  });
  assert.deepEqual(signals, [[100, "SIGTERM"]]);

  rows = [
    { pid: 300, ppid: 1, command: `${bundle}/Contents/MacOS/devhub-desktop` },
    { pid: 301, ppid: 300, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` },
  ];
  signals.length = 0;
  await cleanupOrphans(bundle, {
    stopApp: true,
    list: () => rows,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      rows = rows.filter((row) => row.pid !== pid).map((row) => ({ ...row, ppid: row.ppid === pid ? 1 : row.ppid }));
    },
    sleep: async () => {},
  });
  assert.deepEqual(signals, [[300, "SIGTERM"], [301, "SIGTERM"]]);

  rows = [{ pid: 302, ppid: 1, command: `${bundle}/Contents/MacOS/DevHub` }];
  signals.length = 0;
  await cleanupOrphans(bundle, {
    stopApp: true,
    appExecutable: "DevHub",
    list: () => rows,
    signal: (pid, signal) => { signals.push([pid, signal]); rows = []; },
    sleep: async () => {},
  });
  assert.deepEqual(signals, [[302, "SIGTERM"]]);
});

test("refuses foreign processes and servers belonging to a live app", async () => {
  const app = `${bundle}/Contents/MacOS/devhub-desktop`;
  const rows = [
    { pid: 200, ppid: 1, command: "/usr/bin/node /checkout/packages/mcp/src/http.ts" },
    { pid: 201, ppid: 1, command: `${runtime} /elsewhere/core-server.mjs` },
    { pid: 202, ppid: 1, command: `${bundle}-other/Contents/Resources/runtime/node ${bundle}/Contents/Resources/server/core-server.mjs` },
    { pid: 203, ppid: 1, command: app },
    { pid: 204, ppid: 203, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` },
    { pid: 205, ppid: 1, command: "/bin/sh" },
    { pid: 206, ppid: 205, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` },
  ];
  const signals = [];
  await cleanupOrphans(bundle, { list: () => rows, signal: (...args) => signals.push(args), sleep: async () => {} });
  assert.deepEqual(signals, []);
  await assert.rejects(cleanupOrphans(bundle, { stopApp: true, appExecutable: "../other", list: () => rows }), /Invalid DevHub executable/);
});

test("only signals server entry points, including both tsx processes", async () => {
  let rows = [
    { pid: 400, ppid: 1, command: `${runtime} /foreign/worker.mjs ${bundle}/Contents/Resources/server/core-server.mjs` },
    { pid: 401, ppid: 1, command: `${runtime} /foreign/worker.mjs /checkout/packages/mcp/src/http.ts` },
    { pid: 402, ppid: 400, command: `${runtime} ${bundle}/Contents/Resources/server/core-server.mjs` },
    { pid: 410, ppid: 1, command: `${runtime} /a checkout/node_modules/tsx/dist/cli.mjs /a checkout/packages/mcp/src/http.ts` },
    { pid: 411, ppid: 410, command: `${runtime} --require /a checkout/node_modules/tsx/dist/preflight.cjs --import file:///a%20checkout/node_modules/tsx/dist/loader.mjs /a checkout/packages/mcp/src/http.ts` },
  ];
  const signals = [];
  await cleanupOrphans(bundle, {
    list: () => rows,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      rows = rows.filter((row) => row.pid !== pid).map((row) => ({ ...row, ppid: row.ppid === pid ? 1 : row.ppid }));
    },
    sleep: async () => {},
  });
  assert.deepEqual(signals, [[410, "SIGTERM"], [411, "SIGTERM"]]);
});
