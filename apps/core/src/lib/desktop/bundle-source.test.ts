import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../http/routes/status/packaged-checkout/route";
import { getPackagedCheckoutStatus } from "./bundle-source";

const baseCommit = "a".repeat(40);
const checkoutCommit = "b".repeat(40);
let fixture: string;

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-bundle-source-"));
  const checkout = path.join(fixture, "checkout");
  const server = path.join(fixture, "server");
  const bin = path.join(fixture, "bin");
  fs.mkdirSync(path.join(checkout, ".git"), { recursive: true });
  fs.mkdirSync(server);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(server, "bundle-source.json"), JSON.stringify({ commit: baseCommit }));
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh
case "$1" in
  rev-parse) /bin/sleep 0.25; printf '%s\\n' "$FAKE_GIT_HEAD" ;;
  diff) if [ "$FAKE_GIT_FAIL_DIFF" = 1 ]; then exit 1; fi; printf '%s\\0' "$FAKE_GIT_CHANGED" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  vi.stubEnv("DEVHUB_PACKAGED_RUNTIME", "1");
  vi.stubEnv("DEVHUB_DESKTOP", "1");
  vi.stubEnv("DEVHUB_APP_DATA", path.join(fixture, "data"));
  vi.stubEnv("DEVHUB_SERVER_DIR", server);
  vi.stubEnv("REPO_ROOT", checkout);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("FAKE_GIT_HEAD", checkoutCommit);
  vi.stubEnv("FAKE_GIT_CHANGED", "docs/example.md");
  vi.stubEnv("FAKE_GIT_FAIL_DIFF", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe.runIf(process.platform !== "win32")("packaged checkout status", () => {
  it("does not block the event loop while checking the linked checkout", async () => {
    const result = Promise.resolve(getPackagedCheckoutStatus());
    const winner = await Promise.race([
      result.then(() => "probe"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timer"), 30)),
    ]);
    const status = await result;

    expect(winner).toBe("timer");
    expect(status).toMatchObject({ bundleCommit: baseCommit, checkoutCommit, stale: false });
  });

  it("keeps the rebuild warning for code changes or an unknown diff", async () => {
    vi.stubEnv("FAKE_GIT_CHANGED", "apps/ui/app/page.tsx");
    expect((await getPackagedCheckoutStatus()).stale).toBe(true);

    vi.stubEnv("FAKE_GIT_FAIL_DIFF", "1");
    expect((await getPackagedCheckoutStatus()).stale).toBe(true);
  });

  it("returns the resolved status from the API", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ bundleCommit: baseCommit, checkoutCommit, stale: false });
  });
});
