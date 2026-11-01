import { describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./route";
import { POST as blast } from "./[owner]/[name]/blast/route";
import { POST as visit } from "./[owner]/[name]/brief/route";
import { POST as digest } from "./[owner]/[name]/digest/route";
import { POST as learnOpened } from "./[owner]/[name]/gaps/route";

const origin = "http://localhost:1457";
const headers = { origin, host: "localhost:1457", "content-type": "application/json" };

describe("ownership routes", () => {
  it("authenticates remote refresh before parsing repository data", async () => {
    const response = await GET(new Request(`${origin}/api/own?scope=remote&repos=invalid`));
    expect([401, 403]).toContain(response.status);
  });

  it.each([
    "invalid",
    JSON.stringify([{ fullName: "../escape", defaultBranch: "main" }]),
    JSON.stringify([{ fullName: "team/repo", defaultBranch: "-option" }]),
  ])("rejects unsafe remote refresh data", async repos => {
    const url = new URL(`${origin}/api/own?scope=remote`);
    url.searchParams.set("repos", repos);
    const response = await GET(new Request(url, { headers }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid repositories" });
  });

  it.each([POST, DELETE])("authenticates and validates ownership changes", async handler => {
    const url = `${origin}/api/own`;
    const body = JSON.stringify({ fullName: "invalid/repo/extra" });
    const unauthenticated = await handler(new Request(url, { method: handler === POST ? "POST" : "DELETE", body }));
    expect([401, 403]).toContain(unauthenticated.status);
    const invalid = await handler(new Request(url, { method: handler === POST ? "POST" : "DELETE", headers, body }));
    expect(invalid.status).toBe(400);
  });

  it.each(["../escape", "/absolute", "C:\\absolute", "src/../../escape"])("rejects blast paths outside the repository: %s", async filePath => {
    const request = new Request(`${origin}/api/own/team/repo/blast`, { method: "POST", headers, body: JSON.stringify({ paths: [filePath] }) });
    const response = await blast(request, { params: Promise.resolve({ owner: "team", name: "repo" }) });
    expect(response.status).toBe(400);
  });

  it.each([
    [visit, "brief", { headSha: "../invalid" }],
    [digest, "digest", { sinceSha: "../invalid" }],
    [learnOpened, "gaps", { action: "learn-opened", domainId: "" }],
  ])("validates ownership write inputs", async (handler, endpoint, body) => {
    const request = new Request(`${origin}/api/own/team/repo/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
    const response = await handler(request, { params: Promise.resolve({ owner: "team", name: "repo" }) });
    expect(response.status).toBe(400);
  });
});
