import http from "node:http";
import net from "node:net";

/** Check decoded aliases too; a proxy must not forward ambiguous paths. */
export function blocksPluginManagement(raw: string): boolean {
  try {
    let pathname = raw.startsWith("/") ? raw.split("?")[0] : new URL(raw, "http://localhost").pathname;
    let stable = false;
    for (let i = 0; i < 4; i += 1) {
      let decoded: string;
      try { decoded = decodeURIComponent(pathname); } catch { stable = true; break; }
      if (decoded === pathname) { stable = true; break; }
      pathname = decoded;
    }
    // Still decoding after four rounds is ambiguous; a literal "%" in a name is not.
    if (!stable && /%[0-9a-f]{2}/i.test(pathname)) return true;
    pathname = new URL(pathname.split(/[?#]/)[0].replaceAll("\\", "/").replace(/\/{2,}/g, "/"), "http://localhost").pathname;
    return /^\/api\/plugins(?:\/|$)/i.test(pathname);
  } catch { return true; }
}

/** The LAN dashboard stays usable, but it cannot forward plugin credentials. */
export function dashboardLanProxy(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (blocksPluginManagement(req.url ?? "/")) {
      res.writeHead(403, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("Plugin management is available only on this computer.");
      return;
    }
    const upstream = http.request({ hostname: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    req.pipe(upstream);
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  server.on("upgrade", (req, client, head) => {
    if (blocksPluginManagement(req.url ?? "/")) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host: "127.0.0.1", port }, () => {
      const headers: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    client.on("error", () => upstream.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  return server;
}
