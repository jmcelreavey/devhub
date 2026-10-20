import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ desktop: true, completed: false, redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/desktop/runtime-paths", () => ({ isDesktopRuntime: () => mocks.desktop }));
vi.mock("./first-run", () => ({ readSetupProgress: () => ({ completed: mocks.completed }) }));
vi.mock("@/components/home/HomeWorkSummary", () => ({ HomePage: () => null }));
import Home from "@/app/page";

beforeEach(() => {
  mocks.desktop = true;
  mocks.completed = false;
  mocks.redirect.mockClear();
});
it("opens setup on an unfinished desktop installation", async () => {
  await Home();
  expect(mocks.redirect).toHaveBeenCalledWith("/setup");
});
it("opens Home after finishing or choosing to set up later", async () => {
  mocks.completed = true;
  await Home();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("keeps browser checkouts on Home", async () => {
  mocks.desktop = false;
  await Home();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it("redirects the old Today query on the server, retaining task and profile", async () => {
  mocks.desktop = false;
  await Home({ searchParams: Promise.resolve({ view: "today", task: "abc", taskProfile: "work" }) });
  expect(mocks.redirect).toHaveBeenCalledWith("/?task=abc&taskProfile=work");
});
