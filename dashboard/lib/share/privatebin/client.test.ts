import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { createPaste, deletePaste, instanceUrl } from "./client";

interface Received {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface Reply {
  status?: number;
  json: unknown;
}

/**
 * A stand-in PrivateBin instance.
 *
 * Worth the ~20 lines: the things most likely to break this client are what it
 * puts on the wire (the JSON API header, ciphertext rather than plaintext) and
 * how it reads failures back. Neither is observable through a mocked `fetch`
 * without asserting on the mock instead of the behaviour.
 */
function startFakeInstance(handler: (body: Record<string, unknown>) => Reply) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      received.push({ headers: req.headers, body });
      const reply = handler(body);
      res.writeHead(reply.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.json));
    });
  });
  return new Promise<{ close: () => void; received: Received[]; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        close: () => server.close(),
        received,
        url: `http://127.0.0.1:${port}`,
      });
    });
  });
}

const OK_REPLY: Reply = { json: { status: 0, id: "0123456789abcdef", deletetoken: "tok-123" } };

const originalUrl = process.env.PRIVATEBIN_URL;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.PRIVATEBIN_URL;
  else process.env.PRIVATEBIN_URL = originalUrl;
});

describe("instanceUrl", () => {
  it("defaults to the public instance", () => {
    delete process.env.PRIVATEBIN_URL;
    expect(instanceUrl()).toBe("https://privatebin.net");
  });

  it("strips trailing slashes so URLs do not double up", () => {
    process.env.PRIVATEBIN_URL = "https://paste.example.com///";
    expect(instanceUrl()).toBe("https://paste.example.com");
  });

  it("ignores a blank override", () => {
    process.env.PRIVATEBIN_URL = "   ";
    expect(instanceUrl()).toBe("https://privatebin.net");
  });
});

describe("createPaste", () => {
  it("sends only ciphertext, and never the password", async () => {
    const fake = await startFakeInstance(() => OK_REPLY);
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await createPaste("# Secret\n\nthe quick brown fox", {
        password: "hunter2",
        expire: "1day",
      });

      const [sent] = fake.received;
      const wire = JSON.stringify(sent.body);
      expect(sent.headers["x-requested-with"]).toBe("JSONHttpRequest");
      expect(sent.body.v).toBe(2);
      expect(wire).not.toContain("quick brown fox");
      expect(wire).not.toContain("hunter2");
    } finally {
      fake.close();
    }
  });

  it("marks the paste burn-after-reading and carries the expiry", async () => {
    const fake = await startFakeInstance(() => OK_REPLY);
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await createPaste("note", { expire: "1week" });
      const body = fake.received[0].body as {
        adata: [unknown, string, number, number];
        meta: { expire: string };
      };
      expect(body.meta.expire).toBe("1week");
      expect(body.adata[3]).toBe(1);
    } finally {
      fake.close();
    }
  });

  it("builds a scanner-safe `#-` URL and keeps the key out of the request", async () => {
    const fake = await startFakeInstance(() => OK_REPLY);
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      const created = await createPaste("note");
      expect(created.pasteId).toBe("0123456789abcdef");
      expect(created.deleteToken).toBe("tok-123");
      // The dash is what stops Slack's unfurler burning the paste.
      expect(created.url).toMatch(/\/\?0123456789abcdef#-[1-9A-HJ-NP-Za-km-z]+$/);

      const key = created.url.split("#-")[1];
      expect(JSON.stringify(fake.received[0].body)).not.toContain(key);
    } finally {
      fake.close();
    }
  });

  it("surfaces the instance's own rejection message", async () => {
    const fake = await startFakeInstance(() => ({ json: { status: 1, message: "Paste is too large" } }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(createPaste("note")).rejects.toThrow("Paste is too large");
    } finally {
      fake.close();
    }
  });

  it("reports an HTTP failure", async () => {
    const fake = await startFakeInstance(() => ({ status: 500, json: {} }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(createPaste("note")).rejects.toThrow(/returned 500/);
    } finally {
      fake.close();
    }
  });

  it("rejects a URL that answers but is not PrivateBin", async () => {
    const fake = await startFakeInstance(() => ({ json: { hello: "world" } }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(createPaste("note")).rejects.toThrow(/is it a PrivateBin instance/);
    } finally {
      fake.close();
    }
  });

  it("explains an unreachable instance and names the setting to fix it", async () => {
    process.env.PRIVATEBIN_URL = "http://127.0.0.1:1";
    await expect(createPaste("note")).rejects.toThrow(/PRIVATEBIN_URL/);
  });

  it("refuses an oversized note without hitting the network", async () => {
    const fake = await startFakeInstance(() => OK_REPLY);
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(createPaste("x".repeat(9 * 1024 * 1024))).rejects.toThrow(/too large to share/);
      expect(fake.received).toHaveLength(0);
    } finally {
      fake.close();
    }
  });
});

describe("deletePaste", () => {
  it("posts the paste id and delete token", async () => {
    const fake = await startFakeInstance(() => ({ json: { status: 0, id: "abc" } }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await deletePaste("abc", "tok");
      expect(fake.received[0].body).toMatchObject({ pasteid: "abc", deletetoken: "tok" });
    } finally {
      fake.close();
    }
  });

  it("treats an already-gone paste as success", async () => {
    // The normal case: the recipient read it, so the server already burned it.
    const fake = await startFakeInstance(() => ({ json: { status: 1, message: "Paste not found" } }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(deletePaste("abc", "tok")).resolves.toBeUndefined();
    } finally {
      fake.close();
    }
  });

  it("still throws on a real failure", async () => {
    const fake = await startFakeInstance(() => ({ json: { status: 1, message: "Server on fire" } }));
    process.env.PRIVATEBIN_URL = fake.url;
    try {
      await expect(deletePaste("abc", "tok")).rejects.toThrow("Server on fire");
    } finally {
      fake.close();
    }
  });
});
