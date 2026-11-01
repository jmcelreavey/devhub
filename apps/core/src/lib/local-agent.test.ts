import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { connectLocalAgent } from "../local/ops/agent";
import { LocalAgentHub, remoteEnvDelta } from "../local/ops/transport";
import { requestContext, withRequestContext } from "../local/ops/context";
import { inProcessLocalOps, localOps } from "../local/ops/index";
import { execExternal } from "./exec-external";

describe("paired local agent", () => {
  const url = "ws://127.0.0.1:43460/local-agent";
  let root: string;
  let hub: LocalAgentHub;
  let server: ReturnType<typeof createServer>;
  let agent: WebSocket | undefined;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "r8-cloud-agent-"));
    hub = new LocalAgentHub();
    server = createServer();
    hub.attach(server);
    server.listen(43460, "127.0.0.1");
    await once(server, "listening");
  });
  afterEach(async () => {
    const closed = agent && agent.readyState !== WebSocket.CLOSED ? once(agent, "close") : undefined;
    agent?.terminate();
    hub.close();
    await closed;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    agent = undefined;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const remote = <T>(action: () => T, workspaceId = "fixture") => withRequestContext({ workspaceId, localOps: hub.ops }, action);

  it("rejects wrong secrets and browser origins without consuming a valid pairing", async () => {
    const pairing = hub.pair("fixture");
    await expect(connectLocalAgent(url, { ...pairing, secret: "x".repeat(43) }, root)).rejects.toThrow("connection failed");
    const browser = new WebSocket(url, { headers: { Authorization: `Bearer ${pairing.secret}`, Origin: "https://untrusted.invalid" } });
    await new Promise<void>((resolve) => browser.once("error", () => resolve()));
    agent = await connectLocalAgent(url, pairing, root);
    expect(agent.readyState).toBe(WebSocket.OPEN);
  });

  it("round trips a real local command with workspace context and isolates concurrent scopes", async () => {
    const observed: string[] = [];
    agent = await connectLocalAgent(url, hub.pair("fixture"), root, { run: (cli, args, opts) => {
      observed.push(requestContext()!.workspaceId);
      return inProcessLocalOps.run(cli, args, opts);
    } });
    const result = await remote(() => localOps.run(process.execPath, ["-e", "process.stdout.write(process.cwd())"]));
    expect(result.stdout).toBe(fs.realpathSync(root));
    expect(observed).toEqual(["fixture"]);
    await expect(remote(() => localOps.run(process.execPath, ["--version"]), "other")).rejects.toThrow("not connected");
    expect(() => remote(() => localOps.spawn(process.execPath, []))).toThrow("unavailable");
    await expect(remote(() => localOps.run(process.execPath, [], { cwd: ".." }))).rejects.toThrow("Local operation failed");
    const local = await localOps.run(process.execPath, ["-e", "process.stdout.write('local')"]);
    expect(local.stdout).toBe("local");
    expect(requestContext()).toBeUndefined();
  });

  it("forwards only caller-set variables and keeps the agent's own environment", async () => {
    agent = await connectLocalAgent(url, hub.pair("fixture"), root);
    const result = await remote(() => execExternal(process.execPath, ["-e", `
      const valid = process.env.DEVHUB_ENV_FIXTURE === "forwarded"
        && process.env.DEVHUB_ENV_UNDEFINED === undefined
        && process.env.HOME === ${JSON.stringify(process.env.HOME)};
      process.stdout.write(valid ? "ok" : "unexpected environment");
    `], { env: { DEVHUB_ENV_FIXTURE: "forwarded", DEVHUB_ENV_UNDEFINED: undefined } }));
    expect(result.stdout).toBe("ok");
  });

  it("never forwards inherited server variables", () => {
    const base = { SERVER_SECRET: "fixture-secret", PATH: "/bin" };
    expect(remoteEnvDelta(base, base)).toBeUndefined();
    expect(remoteEnvDelta({ ...base }, base)).toBeUndefined();
    expect(remoteEnvDelta({ ...base, PATH: "/custom", GIT_FLAG: "1", GONE: undefined }, base)).toEqual({ PATH: "/custom", GIT_FLAG: "1" });
  });

  it("rejects invalid and oversized environments without exposing their contents", async () => {
    for (const env of [{ "INVALID=NAME": "fixture" }, { FIXTURE: "invalid\0value" }, { FIXTURE: "x".repeat(65_536) }]) {
      await expect(remote(() => execExternal(process.execPath, [], { env }))).rejects.toEqual(new Error(
        env.FIXTURE?.length === 65_536 ? "Local operation request is too large" : "Invalid local operation request",
      ));
    }
  });

  it("rejects pending work on disconnect, aborts the command and requires a new pairing", async () => {
    const pairing = hub.pair("fixture");
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    let aborted!: () => void;
    const stopped = new Promise<void>((resolve) => { aborted = resolve; });
    agent = await connectLocalAgent(url, pairing, root, { run: (_cli, _args, opts) => new Promise((_resolve, reject) => {
      opts!.signal!.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }, { once: true });
      started();
    }) });
    const result = remote(() => localOps.run("fixture", []));
    const rejection = expect(result).rejects.toThrow("disconnected");
    await running;
    agent.terminate();
    await rejection;
    await stopped;
    await expect(remote(() => localOps.run("fixture", []))).rejects.toThrow("not connected");
    await expect(connectLocalAgent(url, pairing, root)).rejects.toThrow("connection failed");
  });

  it("rejects insecure non-loopback connections", async () => {
    await expect(connectLocalAgent("ws://example.invalid/local-agent", hub.pair("fixture"), root)).rejects.toThrow("requires wss");
  });
});
