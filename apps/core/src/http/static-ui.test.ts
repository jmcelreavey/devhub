import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveStaticUi } from "./static-ui";

let fixture: string;
let dist: string;

beforeEach(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "devhub-static-ui-"));
  dist = path.join(fixture, "dist");
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), "<html>fixture</html>");
  await writeFile(path.join(dist, "assets", "app-AbCd1234.js"), "fixture bundle");
  await writeFile(path.join(dist, "icon.svg"), "<svg/>");
  await writeFile(path.join(dist, "assets", "source.ts"), "source fixture");
  await writeFile(path.join(fixture, "secret.txt"), "secret fixture");
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true });
});

function request(target: string, init: RequestInit = {}): Promise<Response | null> {
  return serveStaticUi(new Request(`http://localhost${target}`, init), target, dist);
}

describe("built UI serving", () => {
  it("serves HTML navigations and HEAD without caching HTML", async () => {
    const headers = { Accept: "text/html,application/xhtml+xml", "Sec-Fetch-Mode": "navigate" };
    for (const target of ["/", "/work?tab=fixture", "/notes/fixture/note.md", "/repos/fixture.repo", "/own/fixture/project.repo"]) {
      const response = await request(target, { headers });
      expect(response?.status).toBe(200);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(await response?.text()).toBe("<html>fixture</html>");
    }
    const head = await request("/work", { method: "HEAD", headers });
    expect(head?.headers.get("content-length")).toBe(String(Buffer.byteLength("<html>fixture</html>")));
    expect(await head?.text()).toBe("");
    expect((await request("/index.html"))?.headers.get("cache-control")).toBe("no-store");
  });

  it("caches hashed Vite assets but revalidates unhashed assets", async () => {
    const bundle = await request("/assets/app-AbCd1234.js");
    expect(bundle?.headers.get("content-type")).toContain("text/javascript");
    expect(bundle?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await bundle?.text()).toBe("fixture bundle");
    const icon = await request("/icon.svg");
    expect(icon?.headers.get("cache-control")).toBe("no-cache");
    const head = await request("/assets/app-AbCd1234.js", { method: "HEAD" });
    expect(head?.headers.get("content-length")).toBe(String(Buffer.byteLength("fixture bundle")));
    expect(await head?.text()).toBe("");
  });

  it("leaves missing APIs, assets, non-navigation requests and source files as 404", async () => {
    const html = { Accept: "text/html" };
    for (const target of ["/api", "/api/missing", "/assets/missing.js", "/assets/missing", "/missing.png", "/src/main.tsx", "/assets/source.ts", "/.env", "/assets/app-AbCd1234.js.map"]) {
      expect(await request(target, { headers: html })).toBeNull();
    }
    expect(await request("/work")).toBeNull();
    expect(await request("/work", { headers: { Accept: "text/html;q=0" } })).toBeNull();
    expect(await request("/work", { headers: { ...html, "Sec-Fetch-Mode": "cors" } })).toBeNull();
    expect(await request("/work", { method: "POST", headers: html })).toBeNull();
    expect(await serveStaticUi(new Request("http://localhost/", { headers: html }), "/", path.join(fixture, "missing"))).toBeNull();
  });

  it("rejects encoded traversal, hidden files and symlinks outside the build", async () => {
    await symlink(path.join(fixture, "secret.txt"), path.join(dist, "assets", "leak-AbCd1234.js"));
    await mkdir(path.join(fixture, "outside"));
    await writeFile(path.join(fixture, "outside", "leak-AbCd1234.js"), "secret fixture");
    await symlink(path.join(fixture, "outside"), path.join(dist, "assets", "outside"), "dir");
    for (const target of ["/%2e%2e/secret.txt", "/assets/%2e%2e/index.html", "/assets/%2e%2e%2fsecret.txt", "/assets/%252e%252e%252fsecret.txt", "/assets/%5c..%5csecret.txt", "/assets/%00.png", "/assets/%FF", "/assets/.hidden.png", "/assets/leak-AbCd1234.js", "/assets/outside/leak-AbCd1234.js"]) {
      expect(await request(target, { headers: { Accept: "text/html" } })).toBeNull();
    }
  });
});
