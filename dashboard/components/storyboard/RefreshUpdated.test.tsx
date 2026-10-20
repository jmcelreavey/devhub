/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RefreshUpdated } from "./RefreshUpdated";
vi.mock("@/lib/tickers", () => ({ useMinuteTick: () => Date.now() }));
afterEach(cleanup);
it("is a keyboard button, ignores rapid clicks, reports refresh failures, and allows a later retry", async () => {
  let reject!: (error: Error) => void;
  const refresh = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<RefreshUpdated at={new Date().toISOString()} onRefresh={refresh} />);
  const button = screen.getByRole("button");
  fireEvent.click(button); fireEvent.click(button);
  expect(refresh).toHaveBeenCalledOnce();
  expect(button).toHaveTextContent("Refreshing…");
  await act(async () => reject(new Error("offline")));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t refresh");
  fireEvent.click(button);
  expect(refresh).toHaveBeenCalledOnce();
});
