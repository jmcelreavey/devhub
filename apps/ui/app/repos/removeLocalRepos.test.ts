import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { removeLocalRepos } from "./removeLocalRepos";

let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

it("deletes only selected repos, continues after a refusal and never retries", async () => {
  directory = mkdtempSync(path.join(os.tmpdir(), "devhub-remove-repos-"));
  for (const name of ["first", "refused", "last space", "untouched"]) {
    mkdirSync(path.join(directory, name));
    writeFileSync(path.join(directory, name, "work.txt"), name);
  }
  const root = directory;
  const requests: string[] = [];
  server = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? "").replace("/api/repos/", ""));
    requests.push(`${request.method} ${name}`);
    if (name === "refused") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Refusing deletion" }));
      return;
    }
    rmSync(path.join(root, name), { recursive: true });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, options: RequestInit) => originalFetch(new URL(url, `http://127.0.0.1:${address.port}`), options));
  const progress: string[] = [];

  const result = await removeLocalRepos(["first", "refused", "last space", "first"], (name) => progress.push(name));

  expect(result).toEqual({
    removed: ["first", "last space"],
    failed: [{ name: "refused", message: "Refusing deletion" }],
  });
  expect(requests).toEqual(["DELETE first", "DELETE refused", "DELETE last space"]);
  expect(progress).toEqual(["first", "refused", "last space"]);
  expect(existsSync(path.join(root, "first"))).toBe(false);
  expect(existsSync(path.join(root, "last space"))).toBe(false);
  expect(existsSync(path.join(root, "refused", "work.txt"))).toBe(true);
  expect(existsSync(path.join(root, "untouched", "work.txt"))).toBe(true);
});
