import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === "win32")("keeps the dashboard responsive while checking MCP processes and binaries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-mcp-status-"));
  temporaryRoots.push(root);
  const servers = path.join(root, "mcp", "shared");
  const binaries = path.join(root, "bin");
  fs.mkdirSync(servers, { recursive: true });
  fs.mkdirSync(binaries);
  fs.writeFileSync(path.join(servers, "alpha.json"), JSON.stringify({ command: "devhub-test-mcp", args: ["worker-token"] }));
  fs.writeFileSync(path.join(servers, "local.json"), JSON.stringify({ command: "REPO_ROOT/bin/local-mcp" }));
  fs.writeFileSync(path.join(servers, "missing.json"), JSON.stringify({ command: "devhub-missing" }));
  fs.writeFileSync(path.join(servers, "remote.json"), JSON.stringify({ url: "https://example.test/mcp" }));
  fs.writeFileSync(path.join(binaries, "local-mcp"), "");

  const writeProbe = (name: string, output: string) => {
    fs.writeFileSync(path.join(binaries, name), `#!/bin/sh
${name === "which" ? 'if [ "$1" != "devhub-test-mcp" ]; then exit 1; fi' : ""}
ticket="$TEST_MCP_MARKERS/${name}"
: > "$ticket.start"
count=0
while [ ! -e "$ticket.release" ] && [ "$count" -lt 30 ]; do
  /bin/sleep 0.05
  count=$((count + 1))
done
if [ ! -e "$ticket.release" ]; then : > "$ticket.timeout"; exit 1; fi
${output}
`, { mode: 0o755 });
  };
  writeProbe("ps", "printf '900000001 1 worker-token\\n900000002 900000001 worker-token\\n'");
  writeProbe("which", "printf '/synthetic/devhub-test-mcp\\n'");

  vi.stubEnv("DEVHUB_DESKTOP", "0");
  vi.stubEnv("REPO_ROOT", root);
  vi.stubEnv("TEST_MCP_MARKERS", root);
  vi.stubEnv("PATH", `${binaries}${path.delimiter}${process.env.PATH ?? ""}`);

  let finished = false;
  const request = GET(new Request("http://localhost/api/status/mcp"));
  void request.then(() => { finished = true; }, () => { finished = true; });
  const deadline = Date.now() + 20_000;
  while (!finished && Date.now() < deadline) {
    for (const entry of fs.readdirSync(root).filter((file) => file.endsWith(".start"))) {
      fs.writeFileSync(path.join(root, `${entry.slice(0, -6)}.release`), "");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(finished).toBe(true);
  const response = await request;
  expect(response.status).toBe(200);
  const markers = fs.readdirSync(root);
  expect(markers.filter((file) => file.endsWith(".timeout"))).toEqual([]);
  expect(markers).toEqual(expect.arrayContaining(["ps.start", "which.start"]));
  expect(await response.json()).toEqual({ servers: [
    { name: "alpha", command: "devhub-test-mcp", fingerprint: "worker-token", binaryExists: true, runningCount: 1, pids: [900000001] },
    { name: "local", command: path.join(binaries, "local-mcp"), fingerprint: path.join(binaries, "local-mcp"), binaryExists: true, runningCount: 0, pids: [] },
    { name: "missing", command: "devhub-missing", fingerprint: "devhub-missing", binaryExists: false, runningCount: 0, pids: [] },
  ] });

  fs.writeFileSync(path.join(binaries, "ps"), "#!/bin/sh\nexit 1\n");
  const unavailable = await GET(new Request("http://localhost/api/status/mcp"));
  expect(await unavailable.json()).toMatchObject({ servers: [
    { name: "alpha", binaryExists: true, runningCount: 0, pids: [] },
    { name: "local", binaryExists: true },
    { name: "missing", binaryExists: false },
  ] });
}, 30_000);
