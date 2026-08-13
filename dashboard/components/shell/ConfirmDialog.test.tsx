/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm, usePrompt } from "@/components/shell/ConfirmDialog";

/**
 * ConfirmDialog gates destructive actions across 22 call sites, and until now
 * had no test — the whole `components/` tree had two, neither of which could
 * touch a DOM. The behaviour that matters is that the promise resolves
 * truthfully: a dialog that resolves `true` on cancel deletes the user's data.
 */
function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({ title: "Delete the thing?" }))}
    >
      trigger
    </button>
  );
}

function PromptHarness({ onResult }: { onResult: (v: string | null) => void }) {
  const prompt = usePrompt();
  return (
    <button
      type="button"
      onClick={async () => onResult(await prompt({ title: "Name it" }))}
    >
      trigger
    </button>
  );
}

describe("useConfirm", () => {
  it("shows the dialog and resolves true when confirmed", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "trigger" }));
    expect(await screen.findByText("Delete the thing?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm|ok|yes|delete/i }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("resolves false when cancelled", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await screen.findByText("Delete the thing?");

    await user.click(screen.getByRole("button", { name: /cancel|no/i }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("resolves false when dismissed with Escape", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ConfirmHarness onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await screen.findByText("Delete the thing?");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

describe("usePrompt", () => {
  it("resolves null when cancelled rather than an empty string", async () => {
    // The distinction matters: callers branch on null to mean "abandoned",
    // and on "" to mean "cleared".
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <PromptHarness onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await screen.findByText("Name it");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
  });
});

describe("consecutive prompts", () => {
  /** Two prompts back to back, the shape of "name it, now give me a URL". */
  function ChainHarness({ onResult }: { onResult: (values: (string | null)[]) => void }) {
    const prompt = usePrompt();
    return (
      <button
        type="button"
        onClick={() => {
          void (async () => {
            const first = await prompt({ title: "Remote name" });
            const second = await prompt({ title: "Remote URL" });
            onResult([first, second]);
          })();
        }}
      >
        trigger
      </button>
    );
  }

  it("opens the second prompt empty rather than holding the first answer", async () => {
    // Regression: `pending` going null and straight back reconciled as the same
    // component, so the input kept its state and the second answer was appended
    // to the first — "upstream" + a URL arrived as one string.
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <ConfirmProvider>
        <ChainHarness onResult={onResult} />
      </ConfirmProvider>,
    );

    await user.click(screen.getByRole("button", { name: "trigger" }));
    await screen.findByText("Remote name");
    await user.keyboard("upstream{Enter}");

    await screen.findByText("Remote URL");
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("");

    await user.keyboard("https://example.test/x.git{Enter}");
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(["upstream", "https://example.test/x.git"]),
    );
  });
});
