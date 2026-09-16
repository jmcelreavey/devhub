/**
 * Client for the root wake helper (desktop/wake-helper).
 *
 * The helper is the only thing on the machine allowed to schedule a wake; the
 * dashboard just tells it "the next job is at T". One request per connection,
 * one line each way — see the helper's module comment for the protocol.
 */
import net from "node:net";

export const WAKE_HELPER_SOCKET = "/var/run/com.devhub.wake-helper.sock";

export interface WakeHelperReply {
  version: string;
  /** Epoch ms of DevHub's scheduled wake, or null when none is set. */
  scheduledAt: number | null;
}

export function parseWakeReply(line: string): WakeHelperReply {
  const trimmed = line.trim();
  if (trimmed.startsWith("err ")) throw new Error(trimmed.slice(4));
  const [status, version, value] = trimmed.split(/\s+/);
  if (status !== "ok" || !version || !value) throw new Error(`Unexpected wake helper reply: ${trimmed.slice(0, 80)}`);
  if (value === "-") return { version, scheduledAt: null };
  const seconds = Number(value);
  if (!Number.isInteger(seconds)) throw new Error(`Unexpected wake helper reply: ${trimmed.slice(0, 80)}`);
  return { version, scheduledAt: seconds * 1_000 };
}

function send(command: string, socketPath: string, timeoutMs: number): Promise<WakeHelperReply> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const socket = net.createConnection(socketPath);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("Wake helper did not answer")));
    socket.on("error", fail);
    socket.on("connect", () => socket.write(`${command}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\n")) return;
      socket.end();
      try {
        resolve(parseWakeReply(buffer.split("\n")[0]));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on("end", () => {
      if (!buffer.includes("\n")) reject(new Error("Wake helper closed the connection without replying"));
    });
  });
}

export function wakeHelperStatus(socketPath = WAKE_HELPER_SOCKET, timeoutMs = 2_000): Promise<WakeHelperReply> {
  return send("status", socketPath, timeoutMs);
}

export function scheduleWake(atMs: number, socketPath = WAKE_HELPER_SOCKET, timeoutMs = 2_000): Promise<WakeHelperReply> {
  return send(`schedule ${Math.floor(atMs / 1_000)}`, socketPath, timeoutMs);
}

export function cancelWake(socketPath = WAKE_HELPER_SOCKET, timeoutMs = 2_000): Promise<WakeHelperReply> {
  return send("cancel", socketPath, timeoutMs);
}
