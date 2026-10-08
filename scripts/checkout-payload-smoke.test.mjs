import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { smokePayload } from "./checkout-payload-smoke.mjs";

function smokeRunner(overrides = {}) {
  let time = 0;
  const calls = [];
  const state = { stopped: 0, exited: false };
  const deps = {
    freePort: async () => 45678,
    now: () => time,
    timeoutMs: 1000,
    sleep: async (ms) => { time += ms; },
    env: { NODE_ENV: "development", __NEXT_PRIVATE_STANDALONE_CONFIG: "old", REPO_ROOT: "/user/checkout", PORT: "1337" },
    start: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return { pid: 12345, exited: () => state.exited, stop: async () => { state.stopped++; } };
    },
    probe: async () => true,
    ...overrides,
  };
  return { deps, calls, state };
}

test("the real health probe rejects an unauthorized or different process", async (context) => {
  let response;
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.match(options.headers["x-devhub-token"], /^[a-f0-9]{64}$/);
    return new Response(JSON.stringify(response.body), { status: response.status });
  });
  for (const reply of [
    { status: 401, body: { error: "Unauthorized" } },
    { status: 200, body: { devhub: true, desktop: true, status: "ready", pid: 99999 } },
    { status: 200, body: { devhub: true, desktop: true, status: "ready", pid: 12345 } },
  ]) {
    response = reply;
    const mock = smokeRunner();
    delete mock.deps.probe;
    if (reply.body.pid === 12345) await smokePayload("/payload", mock.deps);
    else await assert.rejects(smokePayload("/payload", mock.deps), /startup health check/);
    assert.equal(mock.state.stopped, 1);
  }
});

test("payload smoke uses its bundled Node and isolated loopback env, then kills its group", async () => {
  const mock = smokeRunner();
  let probes = 0;
  mock.deps.probe = async (url, timeoutMs, token, pid) => {
    assert.equal(url, "http://127.0.0.1:45678/api/desktop/health");
    assert.ok(timeoutMs <= 1000);
    assert.equal(token, mock.calls[0].options.env.DEVHUB_BOOTSTRAP_TOKEN);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(pid, 12345);
    return ++probes > 1;
  };
  await smokePayload("/payload", mock.deps);
  assert.equal(mock.calls[0].cmd, "/payload/runtime/node");
  assert.deepEqual(mock.calls[0].args, ["/payload/server/server.js"]);
  const env = mock.calls[0].options.env;
  assert.equal(env.PORT, "45678");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.__NEXT_PRIVATE_STANDALONE_CONFIG, undefined);
  assert.equal(env.DEVHUB_SCHEDULER, "0");
  assert.equal(env.DEVHUB_MCP_HTTP, "0");
  assert.notEqual(env.REPO_ROOT, "/user/checkout");
  assert.equal(mock.state.stopped, 1);
  assert.equal(fs.existsSync(env.HOME), false);
});

test("timeout or early process exit fails closed and always stops the server", async () => {
  for (const earlyExit of [false, true]) {
    const mock = smokeRunner({ probe: async () => false });
    mock.state.exited = earlyExit;
    await assert.rejects(smokePayload("/payload", mock.deps), /failed its startup health check/);
    assert.equal(mock.state.stopped, 1);
    assert.equal(fs.existsSync(mock.calls[0].options.env.HOME), false);
  }
});

test("probe errors also stop the group and remove scratch data", async () => {
  const mock = smokeRunner({ probe: async () => { throw new Error("probe failed"); } });
  await assert.rejects(smokePayload("/payload", mock.deps), /probe failed/);
  assert.equal(mock.state.stopped, 1);
  assert.equal(fs.existsSync(mock.calls[0].options.env.HOME), false);
});
