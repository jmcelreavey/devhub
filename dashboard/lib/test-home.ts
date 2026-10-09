import fs from "node:fs";
import path from "node:path";
import { afterAll, vi } from "vitest";

/** Mock os.homedir without changing the process environment or touching personal data. */
export async function isolatedOs() {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const home = fs.realpathSync(fs.mkdtempSync(path.join(actual.tmpdir(), "devhub-test-home-")));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
  return { ...actual, homedir: () => home, default: { ...actual, homedir: () => home } };
}
