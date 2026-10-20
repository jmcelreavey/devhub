/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewMarkdown, parseReviewMarkdown } from "./ReviewMarkdown";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("@/components/shell/ThemeToggle", () => ({ useTheme: () => ({ resolvedMode: "dark" }) }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("loads Mermaid for diagram fences with strict security and leaves ordinary code as text", async () => {
  mermaid.render.mockResolvedValue({ svg: '<svg role="img" aria-label="Review flow"></svg>' });
  render(<ReviewMarkdown markdown={"```mermaid\ngraph TD\nA --> B\n```\n```ts\nconst value = 1;\n```"} />);
  expect(await screen.findByRole("img", { name: "Review flow" })).toBeInTheDocument();
  expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
  expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), "graph TD\nA --> B");
  expect(screen.getByText("const value = 1;").closest("pre")).not.toBeNull();
});

it("keeps invalid Mermaid source readable and escapes unsafe markdown links", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mermaid.render.mockRejectedValue(new Error("Invalid diagram"));
  const { container } = render(<ReviewMarkdown markdown={"```mermaid\nnot a diagram\n```\n[unsafe](javascript:alert)\n<script>bad()</script>"} />);
  await waitFor(() => expect(screen.getByText(/Diagram failed to render/)).toBeInTheDocument());
  expect(screen.getByText("not a diagram").closest("pre")).not.toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  vi.restoreAllMocks();
});

it("keeps blank-line-separated review paragraphs distinct", () => {
  expect(parseReviewMarkdown("First paragraph.\n\nSecond paragraph.")).toEqual([
    { kind: "paragraph", text: "First paragraph." },
    { kind: "paragraph", text: "Second paragraph." },
  ]);
});
