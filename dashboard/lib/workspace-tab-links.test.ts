/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { NO_TAB_INTERCEPT_ATTR, workspaceTabHrefFromClick } from "./workspace-tab-links";

// jsdom resolves relative hrefs against its own document URL, so the origin
// under test has to be that one — not a hand-picked port.
const ORIGIN = window.location.origin;

function anchor(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector("a")!;
}

function click(target: EventTarget | null, over: Partial<Parameters<typeof workspaceTabHrefFromClick>[0]> = {}) {
  return workspaceTabHrefFromClick(
    {
      type: "click",
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      target,
      ...over,
    },
    ORIGIN,
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("workspaceTabHrefFromClick", () => {
  it("claims a Shift-click on an in-app link", () => {
    expect(click(anchor(`<a href="/prs">PRs</a>`))).toBe("/prs");
  });

  it("claims ⌘-click and Ctrl-click too", () => {
    const link = anchor(`<a href="/work">Work</a>`);
    expect(click(link, { shiftKey: false, metaKey: true })).toBe("/work");
    expect(click(link, { shiftKey: false, ctrlKey: true })).toBe("/work");
  });

  it("claims a middle-click", () => {
    const link = anchor(`<a href="/repos">Repos</a>`);
    expect(click(link, { type: "auxclick", button: 1, shiftKey: false })).toBe("/repos");
  });

  it("keeps the query string", () => {
    expect(click(anchor(`<a href="/work?tag=auth">#auth</a>`))).toBe("/work?tag=auth");
  });

  it("resolves a click on a child of the anchor", () => {
    const link = anchor(`<a href="/prs"><span>PRs</span></a>`);
    expect(click(link.querySelector("span"))).toBe("/prs");
  });

  /** Plain clicks are ordinary navigation — the tab strip must not touch them. */
  it("ignores an unmodified left click", () => {
    expect(click(anchor(`<a href="/prs">PRs</a>`), { shiftKey: false })).toBeNull();
  });

  /** Alt-click means "download this" on most platforms. */
  it("ignores Alt-click", () => {
    expect(click(anchor(`<a href="/prs">PRs</a>`), { altKey: true })).toBeNull();
  });

  it("ignores an already-handled event", () => {
    expect(click(anchor(`<a href="/prs">PRs</a>`), { defaultPrevented: true })).toBeNull();
  });

  it("ignores a non-middle aux button", () => {
    expect(click(anchor(`<a href="/prs">a</a>`), { type: "auxclick", button: 2 })).toBeNull();
  });

  /** ExternalLinks owns these — it opens them in the system browser. */
  it("ignores off-origin links", () => {
    expect(click(anchor(`<a href="https://github.com/o/r/pull/1">PR</a>`))).toBeNull();
  });

  it("ignores non-http protocols", () => {
    expect(click(anchor(`<a href="mailto:someone@example.com">mail</a>`))).toBeNull();
  });

  it("ignores downloads", () => {
    expect(click(anchor(`<a href="/api/export.csv" download>CSV</a>`))).toBeNull();
  });

  it("ignores same-page hash links", () => {
    expect(click(anchor(`<a href="#section">Jump</a>`))).toBeNull();
  });

  it("ignores anything opted out with the escape-hatch attribute", () => {
    expect(click(anchor(`<a href="/prs" ${NO_TAB_INTERCEPT_ATTR}>PRs</a>`))).toBeNull();
    const wrapped = anchor(`<div ${NO_TAB_INTERCEPT_ATTR}><a href="/prs">PRs</a></div>`);
    expect(click(wrapped)).toBeNull();
  });

  it("ignores clicks that are not on a link at all", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(click(div)).toBeNull();
    expect(click(null)).toBeNull();
  });
});
