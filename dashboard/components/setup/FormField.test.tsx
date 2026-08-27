/** @vitest-environment jsdom */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { FormField } from "@/app/setup/FormField";

function RevealHarness() {
  const [secret, setSecret] = useState(true);
  return (
    <FormField
      label="API Token"
      value="typed-token"
      onChange={vi.fn()}
      placeholder=""
      secret={secret}
      onToggleSecret={() => setSecret((v) => !v)}
    />
  );
}

describe("FormField secret reveal", () => {
  it("does not submit a wrapping form when the reveal control is clicked", () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const onToggle = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <FormField
          label="API Token"
          value="secret-value"
          onChange={vi.fn()}
          placeholder=""
          secret
          onToggleSecret={onToggle}
        />
        <button type="submit">Save</button>
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show API Token" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("secret-value")).toBeTruthy();
  });

  it("keeps the typed value when switching from password to text", () => {
    render(<RevealHarness />);
    expect(screen.getByDisplayValue("typed-token").getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show API Token" }));
    expect(screen.getByDisplayValue("typed-token").getAttribute("type")).toBe("text");
  });
});
