import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { GET } from "./route";

it("confines terminal logs to valid session ids and preserves clean text", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "item7-terminal-log-"));
  const previous = process.env.DEVHUB_TERMINAL_LOG_DIR;
  process.env.DEVHUB_TERMINAL_LOG_DIR = directory;
  try {
    const invalid = await GET(new Request("http://localhost:1447/api/terminal/log?session=..%2Fsecret"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid or missing session id" });
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect((await GET(new Request(`http://localhost:1447/api/terminal/log?session=${id}`))).status).toBe(404);
    writeFileSync(path.join(directory, `${id}.log`), "\u001b[31mfixture\u001b[0m\n");
    const response = await GET(new Request(`http://localhost:1447/api/terminal/log?session=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("fixture\n");
  } finally {
    if (previous === undefined) delete process.env.DEVHUB_TERMINAL_LOG_DIR;
    else process.env.DEVHUB_TERMINAL_LOG_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
