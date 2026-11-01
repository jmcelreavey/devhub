import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { assertSafePath } from "./filesystem";

interface DataSync {
  environment: string;
  close: () => Promise<void>;
}

async function syncData(root: string, relative: unknown): Promise<void> {
  if (typeof relative !== "string" || relative.length > 1024) throw new Error("Invalid data path");
  const parts = relative === "." ? [] : relative.split("/");
  if (parts.some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,254}$/.test(part) || part === "..")) throw new Error("Invalid data path");
  const file = path.join(root, ...parts);
  assertSafePath(root, file);
  const before = fs.lstatSync(file);
  if (!before.isFile() && !before.isDirectory()) throw new Error("Invalid data target");
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    assertSafePath(root, file);
    const after = fs.lstatSync(file);
    if (before.dev !== opened.dev || before.ino !== opened.ino || after.dev !== opened.dev || after.ino !== opened.ino) throw new Error("Data target changed");
    await new Promise<void>((resolve, reject) => fs.fsync(descriptor, (error) => error ? reject(error) : resolve()));
  } finally { fs.closeSync(descriptor); }
}

function authenticate(value: unknown, token: Buffer): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).sort().join(",") !== "path,token" || typeof request.token !== "string" || !/^[a-f0-9]{64}$/.test(request.token) || typeof request.path !== "string") return undefined;
  return crypto.timingSafeEqual(Buffer.from(request.token, "hex"), token) ? request.path : undefined;
}

export async function startRuntimeDataSync(root: string): Promise<DataSync> {
  const before = fs.lstatSync(root);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error("Invalid data root");
  const resolved = fs.realpathSync(root);
  assertSafePath(resolved, resolved);
  const after = fs.lstatSync(root);
  const target = fs.statSync(resolved);
  if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.dev !== target.dev || before.ino !== target.ino) throw new Error("Data root changed");
  const token = crypto.randomBytes(32);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let pending = Buffer.alloc(0);
    let received = false;
    socket.on("data", (chunk: Buffer) => {
      if (received) return socket.destroy();
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 4096) return socket.destroy();
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      received = true;
      const finish = (ok: boolean) => { if (!socket.destroyed) socket.end(JSON.stringify({ ok }) + "\n"); };
      try {
        if (newline !== pending.length - 1) throw new Error("Invalid request");
        const relative = authenticate(JSON.parse(pending.subarray(0, newline).toString("utf8")), token);
        if (relative === undefined) throw new Error("Invalid request");
        void syncData(resolved, relative).then(() => finish(true), () => finish(false));
      } catch { finish(false); }
    });
  });
  server.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  server.on("error", () => { for (const socket of sockets) socket.destroy(); server.close(); });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Data sync unavailable"); }
  return {
    environment: JSON.stringify({ port: address.port, token: token.toString("hex") }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
