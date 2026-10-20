/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskNoteOp } from "@shared/task-note/sections.ts";
import { TaskNoteQuestions } from "./TaskNoteQuestions";
import { submitTaskNoteOperation } from "./task-note-operation";

vi.mock("swr", () => ({ mutate: vi.fn() }));
const question = { id: "question-one", text: "Keep the last result or fail?", resolved: false };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the shared note question form", () => {
  it("focuses the first answer without writing anything", () => {
    const onOp = vi.fn();
    render(<TaskNoteQuestions questions={[question]} onOp={onOp} autoFocus />);
    expect(screen.getByRole("textbox")).toHaveFocus();
    expect(onOp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });
  it("sends the existing note operation once, including rapid repeated submissions", async () => {
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const onOp = (op: TaskNoteOp) => submitTaskNoteOperation("task-notes/question", op).then(() => true);
    render(<TaskNoteQuestions questions={[question]} onOp={onOp} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep the last result" } });
    expect(fetchMock).not.toHaveBeenCalled();
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0]).toMatchObject(["/api/tasks/note/sections", { method: "POST" }]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ notePath: "task-notes/question", op: "resolve_question", id: question.id, answer: "Keep the last result" });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => { respond(Response.json({ changed: true })); });
  });
  it("keeps a failed answer and its recovery inline", async () => {
    const onOp = vi.fn().mockRejectedValue(new Error("Note changed; refresh before trying again."));
    render(<TaskNoteQuestions questions={[question]} onOp={onOp} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep it" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Note changed");
    expect(screen.getByRole("textbox")).toHaveValue("Keep it");
    expect(screen.getByRole("button", { name: "Answer" })).toBeEnabled();
  });
  it("also keeps the text when a note operation explicitly fails", async () => {
    render(<TaskNoteQuestions questions={[question]} onOp={async () => false} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep it" } });
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the answer");
    expect(screen.getByRole("textbox")).toHaveValue("Keep it");
  });
  it("uses the same guarded operation when reopening a resolved question", async () => {
    const onOp = vi.fn();
    render(<TaskNoteQuestions questions={[{ ...question, resolved: true, answer: "Keep it" }]} onOp={onOp} />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(onOp).toHaveBeenCalledOnce());
    expect(onOp).toHaveBeenCalledWith({ op: "resolve_question", id: question.id, reopen: true });
  });
});

describe("suggested answers", () => {
  it("fills the box on a click and answers only when Answer is pressed", async () => {
    const onOp = vi.fn(async () => true);
    render(<TaskNoteQuestions questions={[{ id: "q1", text: "Set verify to NODE_ENV=test?", options: ["Yes, use NODE_ENV=test", "No, keep it"], resolved: false }]} onOp={onOp} />);
    const box = screen.getByRole("textbox", { name: /Answer:/ });
    expect(box).toHaveAttribute("placeholder", "Or write your own answer");
    fireEvent.click(screen.getByRole("button", { name: "Yes, use NODE_ENV=test" }));
    // Picking an option never answers by itself: a stray click is cheap to undo.
    expect(onOp).not.toHaveBeenCalled();
    expect(box).toHaveValue("Yes, use NODE_ENV=test");
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(onOp).toHaveBeenCalledWith({ op: "resolve_question", id: "q1", answer: "Yes, use NODE_ENV=test" }));
  });
});

describe("asking back", () => {
  it("sends a question to the agent and leaves the question open", async () => {
    const onOp = vi.fn(async () => true);
    const onAskBack = vi.fn(async () => true);
    render(<TaskNoteQuestions questions={[{ id: "q1", text: "Share consent with games too?", resolved: false }]} onOp={onOp} onAskBack={onAskBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask back" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Ask back about/ }), { target: { value: "What does the current flow do on Android?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onAskBack).toHaveBeenCalledWith("What does the current flow do on Android?"));
    expect(onOp).not.toHaveBeenCalled();
  });
});
