import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./registry", () => ({ providerFor: vi.fn() }));
import { writeNow } from "./write-store";
import { IntegrationError, type IntegrationProvider } from "./types";
import { type WriteResult, type PreparedWrite } from "./write-types";

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
function savedWrites(): WriteResult[] { return fs.readdirSync(root).map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) as WriteResult); }
describe("direct integration writes", () => {
  it("prepares once, sends once and records the outcome", async () => {
    const { result, timings } = await writeNow(input, "work", signal, options());
    expect(provider.prepareWrite).toHaveBeenCalledTimes(1);
    expect(provider.executeWrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ state: "succeeded", source: "DevHub", profile: "work" });
    expect(Object.keys(timings)).toEqual(["prepare", "send"]);
    const [saved] = savedWrites();
    expect(saved).toMatchObject({ id: result.id, state: "succeeded" });
  });
  it("persists the unknown state before sending", async () => {
    provider.executeWrite = vi.fn(async () => { expect(savedWrites()[0]).toMatchObject({ state: "unknown" }); throw new Error("socket hang up"); });
    const { result } = await writeNow(input, "work", signal, options());
    expect(result.state).toBe("unknown");
    expect(result.detail).toContain("Outcome unknown");
  });
  it("records a refused preparation as failed and rethrows, so a click is never silent", async () => {
    vi.mocked(provider.prepareWrite!).mockRejectedValueOnce(new IntegrationError("conflict", "This transition is no longer available."));
    await expect(writeNow(input, "work", signal, options())).rejects.toThrow("no longer available");
    expect(savedWrites()).toMatchObject([{ state: "failed", detail: "This transition is no longer available." }]);
    expect(provider.executeWrite).not.toHaveBeenCalled();
  });
  it("keeps the same account and capability gates before execution", async () => {
    provider.accounts = () => [];
    await expect(writeNow(input, "work", signal, options())).rejects.toThrow("account");
    provider.accounts = () => [{ id: "default", provider: "github", label: "Default" }]; provider.capabilities = [];
    await expect(writeNow(input, "work", signal, options())).rejects.toThrow("support");
    expect(provider.prepareWrite).not.toHaveBeenCalled();
  });

});
