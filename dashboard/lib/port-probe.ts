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
