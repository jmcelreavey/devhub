import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { GET, POST } from "../../../../apps/core/src/http/routes/recall/events/route";

test("recall event contracts retain auth, batch validation and idempotent append", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-recall-action-"));
  vi.stubEnv("NOTES_DIR", root);
  vi.stubEnv("DEVHUB_API_SECRET", "fixture-only");
  const event = { id: "fixture", title: "Fixture decision", kind: "decision", source: "fixture" };
  const post = (body: unknown, authenticated = true) => POST(new Request("http://fixture/api/recall/events", { method: "POST", headers: authenticated ? { "x-devhub-secret": "fixture-only" } : {}, body: JSON.stringify(body) }));
  try {
    expect((await post(event, false)).status).toBe(401);
    expect((await post({ ...event, title: "" })).status).toBe(400);
    expect(await (await post(event)).json()).toMatchObject({ written: 1, skipped: 0 });
    expect(await (await post(event)).json()).toMatchObject({ written: 0, skipped: 1 });
    expect(await (await post({ events: [event, { ...event, id: "second" }] })).json()).toMatchObject({ written: 1, skipped: 1 });
    expect((await post({ events: [{ ...event, id: "third" }, { ...event, kind: "invalid" }] })).status).toBe(400);
    expect(await (await GET(new Request("http://fixture/api/recall/events"))).json()).toMatchObject({ total: 2 });
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
