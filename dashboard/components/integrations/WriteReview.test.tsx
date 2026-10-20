/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WriteProposal } from "@/lib/integrations/write-types";

vi.mock("@/components/jira/JiraWidget", () => ({ statusTone: () => "info" }));
vi.mock("@/components/shell/ModalShell", () => ({
  ModalShell: ({ title, description, footer, children }: { title: string; description?: string; footer?: ReactNode; children: ReactNode }) =>
    <div role="dialog" aria-label={title}><h2>{title}</h2><p>{description}</p>{children}{footer}</div>,
}));
import { WriteReview } from "./WriteReview";

const proposal: WriteProposal = {
  id: "c3a1f7a4-0b52-4a0e-9f0b-2f2b7b0f5e11", profile: "work", source: "MCP", state: "pending",
  createdAt: "2026-10-12T09:00:00Z", expiresAt: "2099-10-12T09:15:00Z", digest: "a".repeat(64),
  input: { action: "issue.transition", provider: "jira", account: "default", ref: { provider: "jira", account: "default", kind: "issue", id: "PTF-5106" }, transitionId: "41" },
  prepared: {
    destination: "https://example.atlassian.net/browse/PTF-5106", actor: "John McElreavey (712020:6f1c2b9e-52a4)", summary: "Move PTF-5106 to Done",
    details: { ticket: "Reconcile entitlements", from: "In Progress", transition: "Done", transitionId: "41", to: "Done" }, native: {},
  },
};
const respond = (value: WriteProposal) => vi.fn().mockResolvedValue(Response.json({ proposal: value }));
beforeEach(() => vi.stubGlobal("fetch", respond(proposal)));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WriteReview", () => {
  it("shows one heading, a human summary and keeps technical fields collapsed", async () => {
    render(<WriteReview initial={proposal} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: "Move PTF-5106 to Done" });
    // The action is named once: the heading. The button carries the verb only.
    expect(within(dialog).getAllByText("Move PTF-5106 to Done")).toHaveLength(1);
    expect(await within(dialog).findByRole("button", { name: "Move to Done" })).toBeEnabled();
    expect(within(dialog).getByText("Reconcile entitlements")).toBeInTheDocument();
    expect(within(dialog).getByText("In Progress")).toBeInTheDocument();
    expect(within(dialog).getByText("John McElreavey · Jira")).toBeInTheDocument();
    expect(within(dialog).getByText("An agent through MCP")).toBeInTheDocument();
    const details = dialog.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Done (id 41)")).toBeInTheDocument();
    expect(within(details).getByText("712020:6f1c2b9e-52a4")).toBeInTheDocument();
    // The raw account id never appears outside Details.
    const outside = dialog.textContent!.replace(details.textContent!, "");
    expect(outside).not.toContain("712020");
    expect(outside).not.toContain("Transition Id");
  });
  it("sends nothing until the person confirms, then reports the outcome without repeating the summary", async () => {
    const done: WriteProposal = { ...proposal, state: "succeeded", detail: "Move PTF-5106 to Done", receipt: { detail: "Move PTF-5106 to Done" } };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ proposal }))
      .mockResolvedValueOnce(Response.json({ proposal: done }));
    vi.stubGlobal("fetch", fetcher);
    render(<WriteReview initial={proposal} onClose={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "Move to Done" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "review" });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "confirm", confirmed: true });
    expect(screen.getAllByText("Move PTF-5106 to Done")).toHaveLength(1);
    expect(screen.getByText("Sent and recorded in Recent actions.")).toBeInTheDocument();
  });
  it("says plainly when the outcome is unknown", async () => {
    const unknown: WriteProposal = { ...proposal, state: "unknown", detail: "Check Jira before retrying." };
    vi.stubGlobal("fetch", respond(unknown));
    render(<WriteReview initial={proposal} onClose={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("Outcome unknown. Check Jira before retrying.");
  });
});
