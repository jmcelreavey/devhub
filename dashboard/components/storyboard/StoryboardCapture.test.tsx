/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { StoryboardCapture } from "./StoryboardCapture";

const mocks = vi.hoisted(() => ({ live: vi.fn(), mutate: vi.fn(), success: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive: mocks.live }));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("swr", () => ({ mutate: mocks.mutate }));

beforeEach(() => {
  mocks.live.mockImplementation((key: string | null) => {
    if (key === "/api/repos") return { data: { repos: [{ name: "devhub", branch: "main" }, { name: "sample-api", branch: "main" }] }, mutate: vi.fn() };
    if (key === "/api/tasks/profiles") return { data: { active: "work" }, mutate: mocks.mutate };
    return { data: undefined, mutate: vi.fn() };
  });
  mocks.fetch.mockImplementation(async () => Response.json({ task: { id: "captured", stage: "draft" } }, { status: 201 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Storyboard draft capture", () => {
  it("submits the form/Enter through draft capture, never ordinary creation or an agent launch", async () => {
    const user = userEvent.setup();
    render(<StoryboardCapture />);
    expect(screen.getByText("Saves to work · To do · doesn't start an agent")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    await user.type(input, "  TEST-42 fix the empty state  ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/tasks/capture", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-Devhub-Task-Profile": "work" }), body: JSON.stringify({ text: "TEST-42 fix the empty state", links: [{ kind: "jira", id: "TEST-42", label: "TEST-42" }], profile: "work" }) }));
    expect(input).toHaveValue("");
    expect(mocks.mutate).toHaveBeenCalledWith(expect.any(Function));
  });

  it("guards repeated submissions and preserves the idea on an error", async () => {
    let respond!: (value: Response) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<Response>((resolve) => { respond = resolve; }));
    render(<StoryboardCapture />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep my idea" } });
    const form = screen.getByRole("form", { name: "Capture an idea" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.submit(form);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    respond(Response.json({ error: "Capture unavailable. Try again." }, { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Capture unavailable. Try again.");
    expect(input).toHaveValue("Keep my idea");
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("focuses empty-board capture and refuses to guess a profile", () => {
    mocks.live.mockReturnValue({ data: undefined, error: new Error("Offline"), mutate: mocks.mutate });
    render(<StoryboardCapture empty />);
    expect(screen.getByRole("textbox")).toHaveFocus();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "An idea" } });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.mutate).toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("saves a pasted URL, a Jira key and a #tag as one task, naming the link first", async () => {
    const user = userEvent.setup();
    render(<StoryboardCapture />);
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    fireEvent.change(input, { target: { value: "TEST-42 review https://github.com/acme/app/pull/7 #infra" } });
    // A pasted URL offers an optional link name, same as the Tasks composer.
    await user.type(screen.getByPlaceholderText("e.g. Notes"), "Fix PR{Enter}");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(input).toHaveValue("TEST-42 review [Fix PR](https://github.com/acme/app/pull/7) #infra");
    await user.type(input, "{Enter}");
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(mocks.fetch.mock.calls[0]![1].body))).toEqual({
      text: "TEST-42 review [Fix PR](https://github.com/acme/app/pull/7) #infra",
      links: [{ kind: "jira", id: "TEST-42", label: "TEST-42" }],
      profile: "work",
    });
  });

  it("saves a bare pasted URL on Enter without asking for a name", async () => {
    const user = userEvent.setup();
    render(<StoryboardCapture />);
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    fireEvent.change(input, { target: { value: "TEST-42 https://example.com/x #infra" } });
    await user.type(input, "{Enter}");
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(mocks.fetch.mock.calls[0]![1].body))).toEqual({ text: "TEST-42 https://example.com/x #infra", links: [{ kind: "jira", id: "TEST-42", label: "TEST-42" }], profile: "work" });
  });

  it("opens the @ picker by keyboard and saves the picked link with the one task", async () => {
    const user = userEvent.setup();
    render(<StoryboardCapture />);
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    await user.type(input, "Fix flaky test @dev");
    const option = await screen.findByRole("option", { name: /devhub/ });
    expect(screen.getByRole("listbox", { name: "Link suggestions" })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
    await user.keyboard("{Enter}");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(input).toHaveValue("Fix flaky test ");
    expect(screen.getByRole("link", { name: /devhub/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(mocks.fetch.mock.calls[0]![1].body));
    expect(body).toMatchObject({ text: "Fix flaky test", profile: "work", links: [{ kind: "repo", id: "devhub" }] });
  });

  it("only ever posts to capture: no ready-task, draft-icon or run controls, ⇧↵ included", async () => {
    const user = userEvent.setup();
    render(<StoryboardCapture />);
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Capture as draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Associate repo" })).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Capture an idea or paste a ticket" });
    await user.type(input, "One idea");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(["/api/tasks/capture"]);
    await user.type(input, "Another");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(2));
    expect(mocks.fetch.mock.calls.every(([url]) => url === "/api/tasks/capture")).toBe(true);
  });

  it("keeps Enter from saving twice", async () => {
    let respond!: (value: Response) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<Response>((resolve) => { respond = resolve; }));
    render(<StoryboardCapture />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Once only" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    respond(Response.json({ task: { id: "captured" } }, { status: 201 }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  });
});
