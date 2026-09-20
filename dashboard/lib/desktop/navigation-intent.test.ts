import { describe, expect, it } from "vitest";
import { hasBrowserNavigationIntent } from "./navigation-intent";

describe("agent navigation suppression", () => {
  it("refuses MCP and headless navigation even when dashboard authentication succeeds", () => {
    expect(hasBrowserNavigationIntent(new Headers({ Origin: "http://localhost:1337", "X-DevHub-Secret": "valid" }))).toBe(false);
    expect(hasBrowserNavigationIntent(new Headers({ "Sec-Fetch-Site": "same-origin", "X-DevHub-Client": "mcp" }))).toBe(false);
    expect(hasBrowserNavigationIntent(new Headers({ "Sec-Fetch-Site": "cross-site" }))).toBe(false);
  });
  it("allows the browser's local navigation action", () => {
    expect(hasBrowserNavigationIntent(new Headers({ "Sec-Fetch-Site": "same-origin" }))).toBe(true);
  });
});
