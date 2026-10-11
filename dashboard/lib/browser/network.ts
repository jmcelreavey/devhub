import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { publicAddress, siteOrigin } from "./policy";

export interface BrowserProxy { port: number; close: () => Promise<void> }
/** Pin the actual socket destination, not just a DNS check before Chrome resolves again. */
export async function createBrowserProxy(origins: string[], addresses: string[][]): Promise<BrowserProxy> {
  const hosts = new Map(origins.map((origin, index) => {
    const host = new URL(siteOrigin(origin)).hostname;
    const address = addresses[index]?.[0];
    if (!address || !addresses[index].every(publicAddress)) throw new Error("Browser proxy requires public addresses.");
    return [host + ":443", address];
  }));
  const sockets = new Set<Duplex>();
  const server = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.on("connection", (socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (req, client, head) => {
    const address = hosts.get(req.url ?? "");
    if (!address || head.length) { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    const upstream = net.connect({ host: address, port: 443 });
    sockets.add(upstream);
    const timeout = setTimeout(() => { upstream.destroy(); client.destroy(); }, 5000);
    upstream.once("connect", () => {
      clearTimeout(timeout);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client); client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => { clearTimeout(timeout); sockets.delete(upstream); client.destroy(); });
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser proxy could not bind.");
  return { port: address.port, close: () => new Promise<void>((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  }) };
}
