import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./registry", () => ({ providerFor: vi.fn() }));
import { requestWrite, reviewWrite, confirmWrite, cancelWrite, listWrites } from "./write-store";
import { IntegrationError, type IntegrationProvider } from "./types";
import { WriteInputSchema, type PreparedWrite } from "./write-types";

let root: string;
const signal = new AbortController().signal;
const now = Date.parse("2026-10-10T12:00:00Z");
const input = { action: "pr.create", provider: "github", account: "default", repo: "org/repo", head: "feature", base: "main", title: "A change", body: "Details", draft: true } as const;
const prepared: PreparedWrite = { destination: "https://github.com/org/repo", actor: "alice", summary: "Create draft PR", details: { title: input.title }, native: { headSha: "abc" } };
let provider: IntegrationProvider;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "integration-writes-"));
  provider = { id: "github", apiVersion: 1, label: "GitHub", capabilities: ["pr.create"], accounts: () => [{ id: "default", provider: "github", label: "Default" }], get: vi.fn(), prepareWrite: vi.fn(async () => structuredClone(prepared)), executeWrite: vi.fn(async () => ({ detail: "Created PR" })) };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function options() { return { root, now, provider: () => provider }; }
async function reviewed() { const p = await requestWrite(input, "work", "DevHub", options()); return reviewWrite(p.id, "work", signal, options()); }
describe("confirmed integration writes", () => {
  it("does not write on proposal or review; executes once under competing confirmations", async () => {
    const p = await reviewed(); expect(provider.executeWrite).not.toHaveBeenCalled();
    const results = await Promise.allSettled([confirmWrite(p.id, p.digest!, "work", signal, options()), confirmWrite(p.id, p.digest!, "work", signal, options())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(provider.executeWrite).toHaveBeenCalledTimes(1);
    expect(listWrites("work", root)[0].state).toBe("succeeded");
  });
  it("requires review, matching digest, profile and a live expiry", async () => {
    const p = await requestWrite(input, "work", "DevHub", options());
    await expect(confirmWrite(p.id, "a".repeat(64), "work", signal, options())).rejects.toThrow("Review");
    const r = await reviewWrite(p.id, "work", signal, options());
    await expect(confirmWrite(r.id, r.digest!, "personal", signal, options())).rejects.toThrow("profile");
    await expect(confirmWrite(r.id, "a".repeat(64), "work", signal, options())).rejects.toThrow("Review");
    await expect(confirmWrite(r.id, r.digest!, "work", signal, { ...options(), now: now + 16 * 60000 })).rejects.toThrow("expired");
    expect(provider.executeWrite).not.toHaveBeenCalled();
  });
  it("rejects changed remote evidence and modified proposal content", async () => {
    const p = await reviewed();
    vi.mocked(provider.prepareWrite!).mockResolvedValueOnce({ ...prepared, native: { headSha: "changed" } });
    await expect(confirmWrite(p.id, p.digest!, "work", signal, options())).rejects.toThrow("changed");
    const file = path.join(root, p.id + ".json"); const saved = JSON.parse(fs.readFileSync(file, "utf8")); saved.input.title = "Not approved"; fs.writeFileSync(file, JSON.stringify(saved));
    await expect(confirmWrite(p.id, p.digest!, "work", signal, options())).rejects.toThrow("Review");
    expect(provider.executeWrite).not.toHaveBeenCalled();
  });
  it("blocks removed accounts and revoked capabilities", async () => {
    const p = await reviewed(); provider.accounts = () => [];
    await expect(confirmWrite(p.id, p.digest!, "work", signal, options())).rejects.toThrow("account");
    provider.accounts = () => [{ id: "default", provider: "github", label: "Default" }]; provider.capabilities = [];
    await expect(confirmWrite(p.id, p.digest!, "work", signal, options())).rejects.toThrow("support");
  });
  it("persists uncertain outcomes before sending and never retries after failure or restart", async () => {
    const p = await reviewed();
    provider.executeWrite = vi.fn(async () => { expect(listWrites("work", root)[0].state).toBe("unknown"); throw new Error("secret timeout detail"); });
    const result = await confirmWrite(p.id, p.digest!, "work", signal, options());
    expect(result.state).toBe("unknown"); expect(JSON.stringify(result)).not.toContain("secret timeout");
    await expect(confirmWrite(p.id, p.digest!, "work", signal, options())).rejects.toThrow("no longer");
    expect(provider.executeWrite).toHaveBeenCalledTimes(1);
  });
  it("records a definite rejection and makes cancellation final", async () => {
    const p = await reviewed(); vi.mocked(provider.executeWrite!).mockRejectedValueOnce(new IntegrationError("invalid", "Provider rejected the fields."));
    expect((await confirmWrite(p.id, p.digest!, "work", signal, options())).state).toBe("failed");
    const q = await reviewed(); await cancelWrite(q.id, "work", options());
    await expect(confirmWrite(q.id, q.digest!, "work", signal, options())).rejects.toThrow("no longer");
  });
  it("rejects mismatched refs, traversal and unsupported action fields", () => {
    expect(WriteInputSchema.safeParse({ action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "other", kind: "issue", id: "../bad" }, transitionId: "1" }).success).toBe(false);
    expect(WriteInputSchema.safeParse({ ...input, repo: "../repo" }).success).toBe(false);
    expect(WriteInputSchema.safeParse({ ...input, confirmed: true }).success).toBe(false);
  });
});
