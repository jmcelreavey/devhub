import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must be declared before any imports that use the mocked modules.
const mockExecFile = vi.fn();
const mockPatch = vi.fn();
const mockLoadEnv = vi.fn();

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("../lib/dashboard-env-local", () => ({
  DASHBOARD_MANAGED_ENV_KEYS: ["JIRA_API_TOKEN", "GOOGLE_CLIENT_SECRET", "NOTES_DIR"],
  patchDashboardEnvLocalFile: mockPatch,
}));
vi.mock("./load-env-local-into-process", () => ({
  loadEnvLocalIntoProcessIfUnset: mockLoadEnv,
}));
vi.mock("../lib/sync-opencode-config", () => ({
  getManagedSecretEnvNames: () => ["JIRA_API_TOKEN", "GOOGLE_CLIENT_SECRET"],
}));

// Import after mocks are registered.
const { loadEnvWithOnePasswordFallback, checkOnePasswordStatus } = await import("./op-secrets");

// Helpers — execFile is called as (cmd, args, opts, callback).
function opOk(stdout: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout, stderr: "" }),
  );
}

function opFail(message: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: Error) => void) => cb(new Error(message)),
  );
}

const OP_ITEM_JSON = JSON.stringify({
  fields: [
    { label: "JIRA_API_TOKEN", value: "tok-jira" },
    { label: "GOOGLE_CLIENT_SECRET", value: "gcs-secret" },
    { label: "UNRELATED_FIELD", value: "ignored" },
  ],
});

let tmpDir: string;
const SECRET_KEYS = ["JIRA_API_TOKEN", "GOOGLE_CLIENT_SECRET"];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "op-test-"));
  vi.clearAllMocks();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  // patchDashboardEnvLocalFile must call the mutator so process.env side-effects happen.
  mockPatch.mockImplementation((mutator: (overrides: Map<string, string>) => void) => {
    mutator(new Map());
  });
  for (const k of [...SECRET_KEYS, "DEVHUB_OP_ITEM", "DEVHUB_OP_VAULT", "DEVHUB_OP_REFRESH", "DEVHUB_OP_CACHE"]) {
    delete process.env[k];
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const k of SECRET_KEYS) delete process.env[k];
});

describe("loadEnvWithOnePasswordFallback", () => {
  it("skips op when all secrets are already set in env", async () => {
    process.env.JIRA_API_TOKEN = "existing";
    process.env.GOOGLE_CLIENT_SECRET = "existing";

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("skips op when marker file is present", async () => {
    fs.writeFileSync(path.join(tmpDir, ".env.op-synced"), new Date().toISOString());

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("re-fetches when DEVHUB_OP_REFRESH=1 even if marker exists", async () => {
    process.env.DEVHUB_OP_REFRESH = "1";
    fs.writeFileSync(path.join(tmpDir, ".env.op-synced"), "old");

    opOk("1.x.x"); // version
    opOk("alice@example.com"); // whoami
    opOk(OP_ITEM_JSON); // item get

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  it("writes marker and prints hint when op is not installed", async () => {
    opFail("command not found");

    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });

    await loadEnvWithOnePasswordFallback(tmpDir);

    write.mockRestore();
    expect(out.join("")).toContain("1Password CLI not found");
    expect(fs.existsSync(path.join(tmpDir, ".env.op-synced"))).toBe(true);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("writes marker and prints hint when op is not signed in", async () => {
    opOk("1.x.x"); // version ok
    opFail("not currently signed in"); // whoami fails

    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });

    await loadEnvWithOnePasswordFallback(tmpDir);

    write.mockRestore();
    expect(out.join("")).toContain("not signed in");
    expect(fs.existsSync(path.join(tmpDir, ".env.op-synced"))).toBe(true);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("handles missing item gracefully", async () => {
    opOk("1.x.x");
    opOk("alice");
    opFail("[ERROR] 2023/01/01 isn't an item in any vault");

    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });

    await loadEnvWithOnePasswordFallback(tmpDir);

    write.mockRestore();
    expect(out.join("")).toContain("devhub");
    expect(fs.existsSync(path.join(tmpDir, ".env.op-synced"))).toBe(true);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("handles ambiguous item gracefully", async () => {
    opOk("1.x.x");
    opOk("alice");
    opFail("More than one item matches");

    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });

    await loadEnvWithOnePasswordFallback(tmpDir);

    write.mockRestore();
    expect(out.join("")).toContain("DEVHUB_OP_VAULT");
  });

  it("fetches fields, sets process.env, caches via patchDashboardEnvLocalFile, writes marker", async () => {
    opOk("1.x.x");
    opOk("alice");
    opOk(OP_ITEM_JSON);

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(process.env.JIRA_API_TOKEN).toBe("tok-jira");
    expect(process.env.GOOGLE_CLIENT_SECRET).toBe("gcs-secret");
    expect(mockPatch).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(tmpDir, ".env.op-synced"))).toBe(true);
  });

  it("loads fields without caching when DEVHUB_OP_CACHE=0", async () => {
    process.env.DEVHUB_OP_CACHE = "0";

    opOk("1.x.x");
    opOk("alice");
    opOk(OP_ITEM_JSON);

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(process.env.JIRA_API_TOKEN).toBe("tok-jira");
    expect(process.env.GOOGLE_CLIENT_SECRET).toBe("gcs-secret");
    expect(mockPatch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, ".env.op-synced"))).toBe(false);
  });

  it("does not overwrite keys already set in env (file/env precedence)", async () => {
    process.env.JIRA_API_TOKEN = "already-set";
    // GOOGLE_CLIENT_SECRET is still missing → op will be called

    opOk("1.x.x");
    opOk("alice");
    opOk(OP_ITEM_JSON);

    await loadEnvWithOnePasswordFallback(tmpDir);

    // Existing value must not be overwritten
    expect(process.env.JIRA_API_TOKEN).toBe("already-set");
    // Missing key picked up from 1Password
    expect(process.env.GOOGLE_CLIENT_SECRET).toBe("gcs-secret");
  });

  it("skips fields not present in the item", async () => {
    const partialItem = JSON.stringify({ fields: [{ label: "JIRA_API_TOKEN", value: "tok" }] });
    opOk("1.x.x");
    opOk("alice");
    opOk(partialItem);

    await loadEnvWithOnePasswordFallback(tmpDir);

    expect(process.env.JIRA_API_TOKEN).toBe("tok");
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });
});

describe("checkOnePasswordStatus", () => {
  it("returns installed=false when op not on PATH", async () => {
    opFail("command not found");

    const status = await checkOnePasswordStatus();

    expect(status).toEqual({ installed: false, signedIn: false, itemFound: false });
  });

  it("returns signedIn=false when not authenticated", async () => {
    opOk("1.x.x");
    opFail("not currently signed in");

    const status = await checkOnePasswordStatus();

    expect(status).toEqual({ installed: true, signedIn: false, itemFound: false });
  });

  it("returns itemFound=false when item missing", async () => {
    opOk("1.x.x");
    opOk("alice");
    opFail("isn't an item");

    const status = await checkOnePasswordStatus();

    expect(status).toEqual({ installed: true, signedIn: true, itemFound: false });
  });

  it("returns all true when op is happy", async () => {
    opOk("1.x.x");
    opOk("alice");
    opOk(OP_ITEM_JSON);

    const status = await checkOnePasswordStatus();

    expect(status).toEqual({ installed: true, signedIn: true, itemFound: true });
  });
});
