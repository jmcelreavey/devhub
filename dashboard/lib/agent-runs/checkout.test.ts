import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execExternal } from "@/lib/exec-external";
import { prepareImplementationCheckout, type CheckoutPreparation } from "./checkout";

vi.mock("@/lib/paseo/workspaces", () => ({ loadPaseoWorktreeActivity: vi.fn(async () => []) }));
vi.mock("./store", () => ({ listCapacityRuns: vi.fn(() => []) }));
vi.mock("@/lib/terminal-sessions-registry", () => ({ listRegisteredTerminalSessions: vi.fn(() => []) }));
import { loadPaseoWorktreeActivity } from "@/lib/paseo/workspaces";
import { listRegisteredTerminalSessions } from "@/lib/terminal-sessions-registry";

let root: string;
let checkout: string;
let upstream: string;
let remote: string;
let receipts: CheckoutPreparation[];
async function git(cwd: string, ...args: string[]) {
  return (await execExternal("git", ["-C", cwd, ...args], { timeoutMs: 10_000, label: "checkout-test:git" })).stdout.trim();
}
const record = (receipt: CheckoutPreparation) => { receipts.push(receipt); };
const prepare = () => prepareImplementationCheckout(checkout, "test-run", { record });
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "devhub-checkout-"));
  checkout = path.join(root, "checkout");
  upstream = path.join(root, "upstream");
  remote = path.join(root, "remote.git");
  receipts = [];
  vi.clearAllMocks();
  vi.mocked(loadPaseoWorktreeActivity).mockResolvedValue([]);
  vi.mocked(listRegisteredTerminalSessions).mockReturnValue([]);
  vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(root, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  fs.writeFileSync(path.join(root, "gitconfig"), "[user]\nname = Test\nemail = test@example.com\n[init]\ndefaultBranch = main\n");
  fs.mkdirSync(upstream);
  await git(upstream, "init", "-b", "main");
  fs.writeFileSync(path.join(upstream, "tracked.txt"), "base\n");
  fs.writeFileSync(path.join(upstream, ".gitignore"), ".env\n");
  await git(upstream, "add", ".");
  await git(upstream, "commit", "-m", "base");
  await git(root, "clone", "--bare", upstream, remote);
  await git(root, "clone", remote, checkout);
  await git(upstream, "remote", "add", "origin", remote);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function pushChange(file = "latest.txt", content = "latest\n") {
  fs.writeFileSync(path.join(upstream, file), content);
  await git(upstream, "add", "-f", file);
  await git(upstream, "commit", "-m", "remote change");
  await git(upstream, "push", "origin", "main");
}

describe("fresh shared implementation checkout", () => {
  it("stashes staged, unstaged and untracked changes, preserves ignored files, and starts at current origin/main", async () => {
    await git(checkout, "switch", "-c", "previous-work");
    fs.writeFileSync(path.join(checkout, "tracked.txt"), "staged\n");
    await git(checkout, "add", "tracked.txt");
    fs.appendFileSync(path.join(checkout, "tracked.txt"), "unstaged\n");
    fs.writeFileSync(path.join(checkout, "scratch.txt"), "untracked\n");
    fs.writeFileSync(path.join(checkout, ".env"), "KEEP_LOCAL=1\n");
    await pushChange();
    const receipt = await prepare();
    expect(receipt).toMatchObject({ originalBranch: "previous-work", branch: "main", baseSha: await git(upstream, "rev-parse", "HEAD") });
    expect(await git(checkout, "branch", "--show-current")).toBe("main");
    expect(await git(checkout, "status", "--porcelain")).toBe("");
    expect(fs.readFileSync(path.join(checkout, ".env"), "utf8")).toBe("KEEP_LOCAL=1\n");
    expect(await git(checkout, "show", `${receipt.stashSha}:tracked.txt`)).toBe("staged\nunstaged");
    expect(await git(checkout, "show", `${receipt.stashSha}^2:tracked.txt`)).toBe("staged");
    expect(await git(checkout, "show", `${receipt.stashSha}^3:scratch.txt`)).toBe("untracked");
    expect(receipts.at(-1)).toEqual(receipt);
    await git(checkout, "switch", "previous-work");
    await git(checkout, "stash", "apply", "--index", receipt.stashSha!);
    expect(await git(checkout, "diff", "--cached", "--name-only")).toBe("tracked.txt");
    expect(fs.readFileSync(path.join(checkout, "scratch.txt"), "utf8")).toBe("untracked\n");
  });

  it("does not create empty stashes and discovers a renamed default branch", async () => {
    await git(upstream, "branch", "-m", "main", "trunk");
    await git(upstream, "push", "origin", "trunk");
    await git(remote, "symbolic-ref", "HEAD", "refs/heads/trunk");
    const receipt = await prepare();
    expect(receipt.branch).toBe("trunk");
    expect(receipt.stashSha).toBeUndefined();
    expect(await git(checkout, "branch", "--show-current")).toBe("trunk");
    expect(await git(checkout, "stash", "list")).toBe("");
  });

  it("refuses local commits on main without resetting or stashing them", async () => {
    fs.writeFileSync(path.join(checkout, "local.txt"), "local\n");
    await git(checkout, "add", ".");
    await git(checkout, "commit", "-m", "local main commit");
    const before = await git(checkout, "rev-parse", "HEAD");
    fs.appendFileSync(path.join(checkout, "tracked.txt"), "dirty\n");
    await pushChange();
    await expect(prepare()).rejects.toThrow("local commits or has diverged");
    expect(await git(checkout, "rev-parse", "HEAD")).toBe(before);
    expect(await git(checkout, "stash", "list")).toBe("");
    expect(await git(checkout, "status", "--porcelain")).toContain("tracked.txt");
  });

  it("keeps the stash and ignored file if the updated branch would overwrite it", async () => {
    await git(checkout, "switch", "-c", "previous-work");
    fs.appendFileSync(path.join(checkout, "tracked.txt"), "saved\n");
    fs.writeFileSync(path.join(checkout, ".env"), "KEEP_LOCAL=1\n");
    await pushChange(".env", "REMOTE=1\n");
    await expect(prepare()).rejects.toThrow("Saved changes are in stash");
    expect(receipts.at(-1)?.stashSha).toBeTruthy();
    expect(fs.readFileSync(path.join(checkout, ".env"), "utf8")).toBe("KEEP_LOCAL=1\n");
    expect(await git(checkout, "stash", "list")).toContain("test-run");
  });

  it("does not touch working files when the remote is unavailable", async () => {
    await git(checkout, "remote", "set-url", "origin", path.join(root, "missing"));
    fs.appendFileSync(path.join(checkout, "tracked.txt"), "dirty\n");
    await expect(prepare()).rejects.toThrow();
    expect(await git(checkout, "status", "--porcelain")).toContain("tracked.txt");
    expect(await git(checkout, "stash", "list")).toBe("");
  });

  it("refuses active Paseo work and terminal sessions before saving or switching", async () => {
    vi.mocked(loadPaseoWorktreeActivity).mockResolvedValue([{ path: checkout, active: true, updatedAt: 0 }]);
    await expect(prepare()).rejects.toThrow("Paseo has active work");
    expect(receipts).toEqual([]);
    vi.mocked(loadPaseoWorktreeActivity).mockResolvedValue([]);
    vi.mocked(listRegisteredTerminalSessions).mockReturnValue([{ tabId: 1, cwd: checkout, status: "open", busy: false, updatedAt: 0, sessionId: null, label: "user shell" }]);
    await expect(prepare()).rejects.toThrow("A terminal is using");
  });

  it("refuses an interrupted Git operation and releases the preparation lock", async () => {
    fs.writeFileSync(path.join(checkout, ".git", "MERGE_HEAD"), await git(checkout, "rev-parse", "HEAD"));
    await expect(prepare()).rejects.toThrow("existing Git operation");
    expect(fs.existsSync(path.join(checkout, ".git", "devhub-implementation-preflight.lock"))).toBe(false);
  });
});
