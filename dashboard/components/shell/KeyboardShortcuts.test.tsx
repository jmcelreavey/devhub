// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

beforeEach(() => {
  nav.pathname = "/";
});
afterEach(() => {
  cleanup();
  nav.push.mockClear();
});

function chord(second: string) {
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: second });
}

describe("go-to chords", () => {
  // The pages moved around in the nav clean-up; the chords must not have.
  it.each([
    ["h", "/"],
    ["n", "/notes"],
    ["/", "/search"],
    ["f", "/diagrams"],
    ["s", "/status"],
    ["o", "/ops"],
    ["a", "/actions"],
    ["r", "/repos"],
    ["k", "/skills"],
    ["c", "/agents"],
    ["l", "/calendar"],
    ["j", "/work?tab=jira"],
    ["d", "/datadog"],
    ["t", "/work?tab=tasks"],
    ["w", "/work"],
    ["p", "/prs"],
  ])("g %s still goes to %s", (key, target) => {
    nav.pathname = "/somewhere-else";
    render(<KeyboardShortcuts />);
    chord(key);
    expect(nav.push).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("stays put when you are already there", () => {
    nav.pathname = "/status";
    render(<KeyboardShortcuts />);
    chord("s");
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("ignores a chord typed into a field", () => {
    render(<KeyboardShortcuts />);
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "g" });
    fireEvent.keyDown(input, { key: "s" });
    expect(nav.push).not.toHaveBeenCalled();
    input.remove();
  });
});
