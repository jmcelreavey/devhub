import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const TOKEN = "b".repeat(64);
let savedToken: string | undefined;
let savedDesktop: string | undefined;

beforeEach(() => {
  savedToken = process.env.DEVHUB_BOOTSTRAP_TOKEN;
  savedDesktop = process.env.DEVHUB_DESKTOP;
  process.env.DEVHUB_BOOTSTRAP_TOKEN = TOKEN;
  process.env.DEVHUB_DESKTOP = "1";
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.DEVHUB_BOOTSTRAP_TOKEN;
  else process.env.DEVHUB_BOOTSTRAP_TOKEN = savedToken;
  if (savedDesktop === undefined) delete process.env.DEVHUB_DESKTOP;
  else process.env.DEVHUB_DESKTOP = savedDesktop;
});

const bootstrap = (host: string, query = `token=${TOKEN}`) =>
  new NextRequest(`http://${host}/api/desktop/bootstrap?${query}`, { headers: { host } });

describe("desktop bootstrap redirect", () => {
  it("keeps the host the shell loaded, so the cookie and the page share an origin", async () => {
    // Windows loads 127.0.0.1 (WebView2 tries ::1 for localhost); Next would
    // otherwise rewrite the absolute redirect to "localhost".
    const response = await GET(bootstrap("127.0.0.1:1337"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("works the same for localhost", async () => {
    const response = await GET(bootstrap("localhost:1337"));
    expect(response.headers.get("location")).toBe("/");
  });

  it("honours a same-origin next path", async () => {
    const response = await GET(bootstrap("127.0.0.1:1337", `token=${TOKEN}&next=/agents%3Fview%3Dx`));
    expect(response.headers.get("location")).toBe("/agents?view=x");
  });

  it("never redirects off-origin, even with a valid token", async () => {
    const response = await GET(bootstrap("127.0.0.1:1337", `token=${TOKEN}&next=https://evil.example/x`));
    expect(response.headers.get("location")).toBe("/");
  });

  it("rejects a wrong token without setting a cookie", async () => {
    const response = await GET(bootstrap("127.0.0.1:1337", "token=nope"));
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
