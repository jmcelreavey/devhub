import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ desktop: true, completed: false, redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ isDesktopRuntime: () => mocks.desktop }));
vi.mock("./first-run", () => ({ readSetupProgress: () => ({ completed: mocks.completed }) }));
vi.mock("@/components/today/TodayViewSwitch", () => ({ TodayViewSwitch: () => null }));
import Home from "@/app/page";

beforeEach(() => {
  mocks.desktop = true;
  mocks.completed = false;
  mocks.redirect.mockClear();
});
it("opens setup on an unfinished desktop installation", () => {
  Home();
  expect(mocks.redirect).toHaveBeenCalledWith("/setup");
});
it("opens Today after finishing or choosing to set up later", () => {
  mocks.completed = true;
  Home();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("keeps browser checkouts on Today", () => {
  mocks.desktop = false;
  Home();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
