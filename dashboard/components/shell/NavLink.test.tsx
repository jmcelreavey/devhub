// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavLink } from "./NavLink";

const useLive = vi.hoisted(() => vi.fn(() => ({ data: { needsAttention: 1 } })));
vi.mock("@/lib/hooks/use-fetch", () => ({ useLive }));
vi.mock("next/navigation", () => ({ usePathname: () => "/agents" }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Agents navigation", () => {
  it("does not show historical run attention as unread chats", () => {
    render(<NavLink item={{ href: "/agents", label: "Agents", icon: "agents", group: "system" }} active />);
    expect(screen.getByRole("link", { name: "Agents" })).toHaveTextContent(/^Agents$/);
    expect(useLive).not.toHaveBeenCalled();
  });
});
