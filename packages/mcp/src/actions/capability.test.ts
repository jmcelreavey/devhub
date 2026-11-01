import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { GET as readSession, POST as saveSession } from "../../../../apps/core/src/http/routes/capability/journey/session/route";
import { POST as openWorkspace } from "../../../../apps/core/src/http/routes/capability/workspace/open/route";
import { POST as scan } from "../../../../apps/core/src/http/routes/capability/scan/route";

test("capability contracts retain saved tutor sessions and server-owned workspace selection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-capability-action-"));
  vi.stubEnv("NOTES_DIR", root);
  const request = (url: string, body: unknown) => new Request(`http://fixture${url}`, { method: "POST", body: JSON.stringify(body) });
  const category = "labs/fixture/topic";
  try {
    const messages = [{ role: "user", content: "Fixture question" }];
    expect((await saveSession(request("/session", { category, messages }))).status).toBe(200);
    expect(await (await readSession(new Request(`http://fixture/session?category=${category}`))).json()).toMatchObject({ messages });
    expect((await saveSession(request("/session", { category, clear: true }))).status).toBe(200);
    expect(await (await readSession(new Request(`http://fixture/session?category=${category}`))).json()).toMatchObject({ messages: [] });
    expect((await openWorkspace(request("/open", { category, workspacePath: root }))).status).toBe(404);
    expect((await openWorkspace(request("/open", { category: " " }))).status).toBe(400);
    for (const body of [{ includeGithub: "yes" }, { githubLimit: 0 }, { githubFilter: {} }]) {
      expect((await scan(request("/scan", body))).status).toBe(400);
    }
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
