// @vitest-environment jsdom
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/tasks" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/shell/WorkspaceTabs", () => ({ useWorkspaceTabs: () => ({ openHref: vi.fn(), canOpen: true }) }));

import { AgentLaunchForm } from "./AgentLaunchSheet";

const catalog = {
  connected: true,
  defaultAgentId: "claude",
  agents: [{ id: "claude", name: "Claude", ready: true, models: ["a", "b"] }],
};
const repos = {
  repos: Array.from({ length: 400 }, (_, i) => ({ name: `repo-${i}`, path: `/Users/dev/repo-${i}` })),
  scanDirDisplay: "~/Developer",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const href = String(url);
    if (href === "/api/agent/connection") return Response.json(catalog);
    if (href === "/api/repos") return Response.json(repos);
    if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
    if (href === "/api/tasks/implement/review-settings") return Response.json({ provider: "", model: "" });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("launch sheet typing", () => {
  it("does not re-render the sheet while the task is edited", async () => {
    let commits = 0;
    let commitMs = 0;
    const onRender: ProfilerOnRenderCallback = (_id, _phase, actual) => { commits += 1; commitMs += actual; };
    const context = "line\n".repeat(4000);
    render(
      <Profiler id="launch" onRender={onRender}>
        <AgentLaunchForm
          intent={{ requestId: "1", title: "Implement with agent", prompt: "Do the task\n".repeat(200), context, cwd: "/Users/dev/repo-0", repoName: "repo-0", stage: "implement" }}
          current={() => true}
          close={() => undefined}
        />
      </Profiler>,
    );
    const box = await screen.findByRole("textbox", { name: /what would you like the agent to do/i });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    await screen.findByLabelText(/^Review with/);
    commits = 0;
    commitMs = 0;
    const start = performance.now();
    for (let i = 0; i < 30; i++) fireEvent.change(box, { target: { value: `typed ${i} ${"x".repeat(200)}` } });
    const elapsed = performance.now() - start;
    expect(commits).toBe(0);
    expect(commitMs).toBe(0);
    expect(elapsed).toBeLessThan(500);
  });
});
