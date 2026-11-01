import { afterEach, expect, it } from "vitest";
import { getTerminalProposal, listTerminalProposals, resolveTerminalProposal } from "../terminal/proposals";
import { shouldInjectProposal } from "../../../../../packages/shared/terminal/proposal-policy";
import { runtimeInventory, runtimeSchema } from "../../../../../packages/shared/ui-lib/plugins/runtime-contract";
import { applyRuntimeTerminalProposal } from "./runtime-terminal";

const created: string[] = [];
afterEach(() => { for (const id of created.splice(0)) resolveTerminalProposal(id, "deny"); });

function fixture() {
  const grant = { server: "ops", tool: "ops_connect", label: "Jumpbox", summary: "Connect to the jumpbox" };
  const runtime = runtimeSchema.parse({
    api: "1", transport: "request-worker", entry: "worker.mjs", sha256: "a".repeat(64),
    lockfile: { path: "package-lock.json", sha256: "b".repeat(64) }, pages: [], routes: [],
    mcp: [{ name: "ops", description: "Fixture tools" }], capabilities: { terminalProposals: [grant] },
    permissions: { env: [], network: [], exec: false },
  });
  const request = {
    kind: "mcp", path: "ops", method: "POST",
    body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: grant.tool, arguments: { command: "echo fixture", reason: "A fixture proposal" } } },
  } as const;
  const output = { jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "Proposed __DEVHUB_TERMINAL_PROPOSAL_ID__ (status: pending)." }] }, hostTerminalProposal: true };
  return { grant, runtime, request, output };
}

it("auto-runs ordinary proposals and keeps destructive proposals for confirmation", () => {
  const { runtime, request, output } = fixture();
  const response = applyRuntimeTerminalProposal(runtime, request, output, () => true) as { result: { content: { text: string }[] } };
  const id = response.result.content[0].text.match(/Proposed ([^ ]+) /)?.[1];
  expect(id).toBeTruthy();
  created.push(id!);
  expect(getTerminalProposal(id!)).toMatchObject({ command: "echo fixture", reason: "A fixture proposal", label: "Jumpbox", source: "api", status: "pending", autoRun: true });
  expect(shouldInjectProposal({ autoRun: false, command: "echo fixture", skipConfirm: true })).toBe(true);
  expect(response).not.toHaveProperty("hostTerminalProposal");
  expect(runtimeInventory(runtime).find(group => group.kind === "Terminal proposals")?.entries[0]).toContain("destructive commands require confirmation");

  const destructiveRequest = { ...request, body: { ...request.body, params: { ...request.body.params, arguments: { command: "rm -rf /tmp/fixture" } } } };
  const destructiveResponse = applyRuntimeTerminalProposal(runtime, destructiveRequest, output, () => true) as { result: { content: { text: string }[] } };
  const destructiveId = destructiveResponse.result.content[0].text.match(/Proposed ([^ ]+) /)?.[1];
  expect(destructiveId).toBeTruthy();
  created.push(destructiveId!);
  const destructive = getTerminalProposal(destructiveId!);
  expect(destructive).toMatchObject({ destructive: true, autoRun: false });
  expect(shouldInjectProposal({ autoRun: true, command: destructive!.command, skipConfirm: destructive!.autoRun })).toBe(false);
});

it("rejects undeclared, malformed, failed and stale proposal requests", () => {
  const { runtime, request, output } = fixture();
  const before = listTerminalProposals({ status: "pending" }).length;
  for (const invalid of [
    { ...request, path: "other" },
    { ...request, method: "GET" },
    { ...request, body: { ...request.body, method: "tools/list" } },
    { ...request, body: { ...request.body, params: { ...request.body.params, name: "other" } } },
    { ...request, body: { ...request.body, params: { ...request.body.params, arguments: { command: "" } } } },
    { ...request, body: { ...request.body, params: { ...request.body.params, arguments: { command: "echo fixture", autoRun: true } } } },
  ]) expect(() => applyRuntimeTerminalProposal(runtime, invalid, output, () => true)).toThrow();
  for (const invalid of [
    { ...output, id: 8 },
    { ...output, hostTerminalProposal: false },
    { ...output, result: { ...output.result, isError: true } },
    { ...output, result: { content: [{ type: "text", text: "No proposal marker" }] } },
    { ...output, hostSettings: { AWS_PROFILE: "dev" } },
  ]) expect(() => applyRuntimeTerminalProposal(runtime, request, invalid, () => true)).toThrow();
  expect(() => applyRuntimeTerminalProposal(runtime, request, output, () => false)).toThrow();
  expect(listTerminalProposals({ status: "pending" })).toHaveLength(before);
  expect(applyRuntimeTerminalProposal(runtime, request, { ok: true }, () => false)).toEqual({ ok: true });
});

it("requires distinct reviewed tools on a declared MCP server", () => {
  const { grant, runtime } = fixture();
  for (const candidate of [
    { ...runtime, mcp: [] },
    { ...runtime, capabilities: { terminalProposals: [grant, grant] } },
    { ...runtime, capabilities: { terminalProposals: [{ ...grant, tool: "../bad" }] } },
    { ...runtime, capabilities: { terminalProposals: [{ ...grant, autoRun: true }] } },
  ]) expect(runtimeSchema.safeParse(candidate).success).toBe(false);
});
