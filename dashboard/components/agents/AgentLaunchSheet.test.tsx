// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ push: vi.fn(), toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: ui.push }), usePathname: () => "/repos" }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ui.toast }));
import { AgentLaunchForm, AgentLaunchSheet } from "./AgentLaunchSheet";
import { openAgentHandoff } from "@/lib/agent-handoff";

const catalog = {
  connected: true,
  defaultAssistantId: "claude",
  defaultCwd: "/Users/jmcelreavey/Library/Application Support/DevHub",
  assistants: [{ id: "claude", name: "Claude", enabled: true, agent_status: "online", models: [] }],
};
const repos = {
  repos: [
    { name: "sample-svc", path: "/Users/dev/sample-svc" },
    { name: "app", path: "/Users/dev/app" },
  ],
  scanDirDisplay: "~/Developer",
};
let accept: (response: Response) => void;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
  request = vi.fn<typeof fetch>(async (url) => {
    const href = String(url);
    if (href === "/api/aionui/connection") return Response.json(catalog);
    if (href === "/api/repos") return Response.json(repos);
    if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
    return await new Promise<Response>(resolve => { accept = resolve; });
  });
  vi.stubGlobal("fetch", request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => act(() => openAgentHandoff({ title: "Explain output", context: "  exact output\n$ dangerous-looking-text", cwd: "/project", worktree: false }));
describe("agent handoff", () => {
  it("captures quoted context without sending until Start chat is clicked", async () => {
    render(<AgentLaunchSheet />); open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    expect(request.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "What would you like the agent to do?" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload.prompt).toContain(">   exact output\n> $ dangerous-looking-text");
    expect(payload).toMatchObject({ cwd: "/project", worktree: false, provider: "claude" });
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    expect(ui.push).toHaveBeenCalledWith("/agents?conversation=chat");
  });
  it("does not navigate or close a newer handoff when an earlier start finishes", async () => {
    render(<AgentLaunchSheet />); open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "What would you like the agent to do?" }), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    act(() => openAgentHandoff({ title: "A newer task", prompt: "Other work", cwd: "/project" }));
    await act(async () => accept(Response.json({ run: { id: "run", conversationId: "chat", state: "running" } })));
    expect(ui.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "A newer task" })).toBeTruthy();
  });
});

describe("working folder", () => {
  function renderPlan() {
    render(
      <AgentLaunchForm
        intent={{ requestId: "1", title: "Write plan with agent", prompt: "Write the plan", repoName: "app", stage: "plan" }}
        current={() => true}
        close={() => undefined}
        resolveCwd={async () => "/wrong"}
      />,
    );
  }

  it("defaults to the assigned repo instead of the workspace fallback", async () => {
    renderPlan();
    await waitFor(() => expect(screen.getByLabelText("Working folder")).toHaveValue("/Users/dev/app"));
    expect(screen.getByLabelText("Working folder")).not.toHaveValue(catalog.defaultCwd);
    expect(screen.getByText("/Users/dev/app")).toBeTruthy();
  });

  it("lets you pick another local repo and submits that path", async () => {
    renderPlan();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start chat" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Working folder"), { target: { value: "/Users/dev/sample-svc" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(accept).toBeTypeOf("function"));
    const payload = JSON.parse(String(request.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body));
    expect(payload).toMatchObject({ cwd: "/Users/dev/sample-svc", repoName: "sample-svc" });
  });

  it("offers GitHub clone when the assigned repo is not on disk", async () => {
    request.mockImplementation(async (url) => {
      const href = String(url);
      if (href === "/api/aionui/connection") return Response.json(catalog);
      if (href === "/api/repos") return Response.json({ repos: [{ name: "sample-svc", path: "/Users/dev/sample-svc" }], scanDirDisplay: "~/Developer" });
      if (href.startsWith("/api/repos/github")) return Response.json({ repos: [] });
      return await new Promise<Response>(resolve => { accept = resolve; });
    });
    renderPlan();
    await waitFor(() => expect(screen.getByText(/Linked repo “app” isn’t in ~\/Developer/)).toBeTruthy());
    expect(screen.getByLabelText("GitHub repo")).toBeTruthy();
  });
});
