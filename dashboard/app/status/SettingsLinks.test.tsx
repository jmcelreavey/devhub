// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsLinks } from "./SettingsLinks";

afterEach(cleanup);

describe("SettingsLinks", () => {
  it("puts Agent skills and the QA lab one click from Settings", () => {
    render(<SettingsLinks />);
    const links = within(screen.getByRole("navigation", { name: "More in Settings" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Agent skills", "/skills"],
      ["QA lab", "/qa"],
    ]);
  });
});
