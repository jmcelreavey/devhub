import { spawnSync } from "node:child_process";
import net from "node:net";

/** True when something accepts TCP connections on host:port. */
export function canConnect(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Bind port 0, then close — returns a currently-free ephemeral port. */
export async function reserveEphemeralPort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("expected inet address"));
        return;
      }
      const port = addr.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/** True when host:port is free to bind (nothing listening). */
export function canBindPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export async function waitForPortListening(
  port: number,
  timeoutMs = 30_000,
  host = "127.0.0.1",
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export function pidsListeningOnPort(port: number): number[] {
  if (process.platform === "win32") return [];
  const res = spawnSync("lsof", ["-ti", "-sTCP:LISTEN", `tcp:${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (!res.stdout?.trim()) return [];
  return res.stdout
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

export function commandForPid(pid: number): string | null {
  const res = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "args="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const cmd = res.stdout?.trim();
  return cmd || null;
}

/** Command + env as `ps eww` prints it. Empty when the pid is gone. */
export function commandAndEnvForPid(pid: number): string {
  const res = spawnSync("ps", ["eww", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return res.stdout ?? "";
}

/** `ps -o etime=` → `[[dd-]hh:]mm:ss`. */
export function parsePsEtime(raw: string): number | null {
  const parts = raw.trim().split(/[-:]/).map((n) => Number.parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 4) return parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
  return null;
}

export function processElapsedSeconds(pid: number): number | null {
  const res = spawnSync("ps", ["-p", String(pid), "-o", "etime="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const raw = res.stdout?.trim();
  return raw ? parsePsEtime(raw) : null;
}

export function killPidsListeningOnPort(port: number, signal: NodeJS.Signals = "SIGTERM"): number[] {
  const pids = pidsListeningOnPort(port);
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
  return pids;
}
