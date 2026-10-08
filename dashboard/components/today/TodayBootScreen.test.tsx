/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BootScreen, BootScreenProvider } from "./TodayBootScreen";

afterEach(cleanup);

describe("one shell boot screen", () => {
  it("server-renders one live status even with fallback and page requests", () => {
    const html = renderToString(<BootScreenProvider>
      <BootScreen state="loading" /><BootScreen state="loading" />
    </BootScreenProvider>);
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("hands off between route and page without remounting the mark", () => {
    const view = render(<BootScreenProvider>
      <BootScreen key="route" state="loading" /><BootScreen key="page" state="loading" />
    </BootScreenProvider>);
    const status = screen.getByRole("status", { name: "Loading DevHub" });
    expect(view.container.querySelectorAll(".boot-screen")).toHaveLength(1);
    view.rerender(<BootScreenProvider><BootScreen key="page" state="loading" /></BootScreenProvider>);
    expect(screen.getByRole("status")).toBe(status);
    view.rerender(<BootScreenProvider><BootScreen key="page" state="leaving" /></BootScreenProvider>);
    expect(status.classList.contains("boot-screen-leaving")).toBe(true);
    view.rerender(<BootScreenProvider><BootScreen key="page" state="done" /></BootScreenProvider>);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps an active request visible until the last loader finishes", () => {
    const view = render(<BootScreenProvider>
      <BootScreen state="leaving" /><BootScreen state="loading" />
    </BootScreenProvider>);
    expect(screen.getByRole("status").classList.contains("boot-screen-leaving")).toBe(false);
    view.rerender(<BootScreenProvider><BootScreen state="done" /></BootScreenProvider>);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
