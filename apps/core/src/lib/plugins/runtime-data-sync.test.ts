import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { startRuntimeDataSync } from "./runtime-data-sync";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startRuntimeDataSync>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "runtime-data-sync-")));
  roots.push(root);
  fs.mkdirSync(path.join(root, "requests"));
  fs.writeFileSync(path.join(root, "requests", "record"), "fixture");
  const server = await startRuntimeDataSync(root);
  servers.push(server);
  const endpoint = JSON.parse(server.environment) as { port: number; token: string };
  return { root, server, endpoint };
}

async function request(endpoint: { port: number; token: string }, input: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint.port, "127.0.0.1");
    let text = "";
    socket.once("connect", () => socket.write(JSON.stringify(input) + "\n"));
    socket.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
    socket.once("end", () => {
      try { resolve(JSON.parse(text)); }
      catch (error) { reject(error); }
    });
    socket.once("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Fixture request timed out")); });
  });
}

it("syncs only regular data and directories for the owning service", async () => {
  const { endpoint } = await fixture();
  const sync = vi.spyOn(fs, "fsync");
  for (const file of [".", "requests", "requests/record"]) {
    expect(await request(endpoint, { token: endpoint.token, path: file })).toEqual({ ok: true });
  }
  expect(sync).toHaveBeenCalledTimes(3);
});

it("refuses foreign tokens, escaping paths and symlinks without exposing errors", async () => {
  const { root, endpoint } = await fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-sync-outside-"));
  roots.push(outside);
  fs.writeFileSync(path.join(outside, "secret"), "fixture");
  const sync = vi.spyOn(fs, "fsync");
  const inputs = [
    { token: "0".repeat(64), path: "requests/record" },
    { token: endpoint.token, path: "../outside" },
    { token: endpoint.token, path: path.join(outside, "secret") },
    { token: endpoint.token, path: "requests/record", extra: true },
  ];
  if (process.platform !== "win32") {
    fs.symlinkSync(outside, path.join(root, "linked"), "dir");
    inputs.push({ token: endpoint.token, path: "linked/secret" });
  }
  for (const input of inputs) {
    expect(await request(endpoint, input)).toEqual({ ok: false });
  }
  expect(sync).not.toHaveBeenCalled();
  sync.mockImplementation((_descriptor, callback) => { callback(new Error("private fixture detail")); });
  expect(await request(endpoint, { token: endpoint.token, path: "requests/record" })).toEqual({ ok: false });
});

it("closes the endpoint when the service ends", async () => {
  const { server, endpoint } = await fixture();
  await server.close();
  servers.splice(servers.indexOf(server), 1);
  await expect(request(endpoint, { token: endpoint.token, path: "." })).rejects.toThrow();
});

it("refuses a symlink as the data root", async () => {
  if (process.platform === "win32") return;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-sync-root-"));
  roots.push(parent);
  const directory = path.join(parent, "data");
  fs.mkdirSync(directory);
  const link = path.join(parent, "link");
  fs.symlinkSync(directory, link, "dir");
  await expect(startRuntimeDataSync(link)).rejects.toThrow(/data root/i);
});
