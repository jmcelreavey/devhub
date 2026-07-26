/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteError, routeError } from "@/components/ui/RouteError";

/**
 * This boundary is now on 29 routes, so a bug here is a bug on nearly every
 * page — and it only renders when something has already gone wrong, which is
 * the worst time to discover it doesn't work.
 */
const error = Object.assign(new Error("Datadog token expired"), { digest: "abc123" });

describe("RouteError", () => {
  it("shows the message and offers a retry that calls reset", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<RouteError error={error} reset={reset} />);

    expect(screen.getByText("Datadog token expired")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("falls back to a generic heading when the route gives none", () => {
    render(<RouteError error={error} reset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
  });

  it("prefers the route's own title and remedy", () => {
    render(
      <RouteError
        error={error}
        reset={vi.fn()}
        title="Couldn't load Datadog"
        hint={<>Check <code>DATADOG_API_KEY</code>.</>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Couldn't load Datadog" })).toBeInTheDocument();
    expect(screen.getByText("DATADOG_API_KEY")).toBeInTheDocument();
  });

  it("renders without a <pre> when the error has no message", () => {
    const { container } = render(<RouteError error={new Error("")} reset={vi.fn()} />);
    expect(container.querySelector("pre")).toBeNull();
  });
});

describe("routeError factory", () => {
  it("binds defaults while still receiving error and reset from Next", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const Bound = routeError({ title: "Couldn't load repos", hint: "Check the scan directory." });

    render(<Bound error={error} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Couldn't load repos" })).toBeInTheDocument();
    expect(screen.getByText("Check the scan directory.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
