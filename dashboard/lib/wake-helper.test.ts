import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { cancelWake, parseWakeReply, scheduleWake, wakeHelperStatus } from "./wake-helper";

describe("parseWakeReply", () => {
  it("reads a scheduled wake as epoch ms", () => {
    expect(parseWakeReply("ok 1.0.0 1700000000\n")).toEqual({ version: "1.0.0", scheduledAt: 1_700_000_000_000 });
  });

  it("reads no wake", () => {
    expect(parseWakeReply("ok 1.0.0 -")).toEqual({ version: "1.0.0", scheduledAt: null });
  });

  it("surfaces helper errors and rejects garbage", () => {
    expect(() => parseWakeReply("err wake time must be in the future")).toThrow("wake time must be in the future");
    expect(() => parseWakeReply("ok 1.0.0")).toThrow();
    expect(() => parseWakeReply("ok 1.0.0 soon")).toThrow();
    expect(() => parseWakeReply("hello")).toThrow();
  });
});

describe("socket client", () => {
  let dir: string | null = null;
  let server: net.Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    server = null;
    dir = null;
  });

  async function fakeHelper(reply: (line: string) => string): Promise<{ socket: string; seen: string[] }> {
    // Unix socket paths are capped near 104 bytes; os.tmpdir() on macOS is long.
    dir = fs.mkdtempSync(path.join("/tmp", "wake-"));
    const socket = path.join(dir, "s");
    const seen: string[] = [];
    server = net.createServer((conn) => {
      conn.on("data", (chunk) => {
        const line = chunk.toString().trim();
        seen.push(line);
        conn.end(reply(line));
      });
    });
    await new Promise<void>((resolve) => server!.listen(socket, resolve));
    return { socket, seen };
  }

  it("sends whole seconds and parses the reply", async () => {
    const { socket, seen } = await fakeHelper((line) => `ok 1.0.0 ${line.split(" ")[1] ?? "-"}\n`);
    const reply = await scheduleWake(1_700_000_000_999, socket);
    expect(seen).toEqual(["schedule 1700000000"]);
    expect(reply.scheduledAt).toBe(1_700_000_000_000);
  });

  it("sends status and cancel", async () => {
    const { socket, seen } = await fakeHelper(() => "ok 1.0.0 -\n");
    await wakeHelperStatus(socket);
    await cancelWake(socket);
    expect(seen).toEqual(["status", "cancel"]);
  });

  it("rejects when no helper is installed", async () => {
    await expect(wakeHelperStatus("/tmp/definitely-not-a-devhub-socket")).rejects.toThrow();
  });
});
