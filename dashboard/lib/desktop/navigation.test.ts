import { describe, expect, it, vi } from "vitest";
import { publishDesktopNavigation, subscribeToDesktopNavigation } from "./navigation";

describe("desktop navigation", () => {
  it("delivers a request to every connected desktop listener", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribeToDesktopNavigation(first);
    const unsubscribeSecond = subscribeToDesktopNavigation(second);
    const navigation = { href: "/notes/discovery/example", newTab: true } as const;

    expect(publishDesktopNavigation(navigation)).toBe(2);
    expect(first).toHaveBeenCalledWith(navigation);
    expect(second).toHaveBeenCalledWith(navigation);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops delivering after a listener disconnects", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDesktopNavigation(listener);
    unsubscribe();

    expect(publishDesktopNavigation({ href: "/notes/example", newTab: true })).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops a broken listener without blocking healthy ones", () => {
    const broken = vi.fn(() => {
      throw new Error("closed stream");
    });
    const healthy = vi.fn();
    subscribeToDesktopNavigation(broken);
    const unsubscribeHealthy = subscribeToDesktopNavigation(healthy);
    const navigation = { href: "/notes/example", newTab: true } as const;

    expect(publishDesktopNavigation(navigation)).toBe(1);
    expect(publishDesktopNavigation(navigation)).toBe(1);
    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(2);

    unsubscribeHealthy();
  });
});
