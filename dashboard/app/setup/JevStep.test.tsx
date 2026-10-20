// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JevStep, type TypesafeKeySource } from "./JevStep";
import { SECRET_FIELD_MASK } from "./shared";

afterEach(cleanup);

function renderStep(source: TypesafeKeySource, apiKey = "") {
  const props = { apiKey, onApiKeyChange: vi.fn(), showSecret: false, onToggleSecret: vi.fn(), source, checking: false, onTest: vi.fn(), error: "", checkOk: "" };
  render(<JevStep {...props} />);
  return props;
}

describe("JevStep", () => {
  it("shows a masked key field, a Test button and the not-configured status", () => {
    const props = renderStep(null);
    const input = screen.getByLabelText("TypeSafe API key");
    expect(input).toHaveAccessibleDescription(/never in the repo/);
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("status")).toHaveTextContent("Not configured");
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(props.onTest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["setup", "Jev key saved"],
    ["env", "server environment"],
    ["repo-env", "repo's .env file"],
  ] as const)("says where a %s key comes from", (source, text) => {
    renderStep(source);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByPlaceholderText("Paste a new key to replace")).toBeInTheDocument();
  });

  it("clears the saved-key mask on focus so a paste replaces it", () => {
    const props = renderStep("setup", SECRET_FIELD_MASK);
    fireEvent.focus(screen.getByPlaceholderText("Paste a new key to replace"));
    expect(props.onApiKeyChange).toHaveBeenCalledWith("");
  });
});
