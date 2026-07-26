/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoogleSetupSteps } from "@/components/setup/GoogleSetupSteps";

/**
 * This renders in the *unconfigured* branch of the Calendar step, which anyone
 * with a working calendar never sees again — so it can't be checked by looking
 * at a configured machine. Hence tests.
 */
describe("GoogleSetupSteps", () => {
  it("renders the whole sequence as discrete steps", () => {
    render(<GoogleSetupSteps />);
    // Seven ordered steps, not one paragraph containing seven actions.
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("shows the redirect URI derived from the real origin", () => {
    render(<GoogleSetupSteps />);
    // The whole point: not a hardcoded localhost:1337 example the user has to
    // mentally translate to whatever host they actually opened.
    const expected = `${window.location.origin}/api/calendar/auth/callback`;
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("offers to copy the redirect URI rather than making you retype it", () => {
    render(<GoogleSetupSteps />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("calls out the test-user step, which is the classic late failure", () => {
    render(<GoogleSetupSteps />);
    // Appears both as a step title and as the console link label.
    expect(screen.getAllByText(/test user/i).length).toBeGreaterThan(0);
  });

  it("names redirect_uri_mismatch so the error is recognisable when it appears", () => {
    render(<GoogleSetupSteps />);
    expect(screen.getByText(/redirect_uri_mismatch/)).toBeTruthy();
  });

  it("states that credentials stay on this machine", () => {
    render(<GoogleSetupSteps />);
    expect(screen.getByText(/never leave this\s+machine/i)).toBeTruthy();
  });

  it("opens every external link safely", () => {
    const { container } = render(<GoogleSetupSteps />);
    const links = [...container.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(4);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
  });
});
