/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { TaskCost } from "./TaskCost";
import { WorkCost } from "./WorkCost";
afterEach(cleanup);
it("shows all priced runs and their models, with a quiet total", () => {
  const usage = Array.from({ length: 6 }, (_, i) => ({ runId: `run${i}`, role: "plan", model: `model${i}`, status: "done", costUsd: 0.1 }));
  render(<TaskCost card={{ usage, steps: usage.slice(0, 4), costUsd: 0.6 } as BoardCard} />);
  expect(screen.getByText("Reported cost ≈$0.60")).toBeInTheDocument();
  expect(screen.getByLabelText("Cost by run and model").children).toHaveLength(6);
  expect(screen.getByText(/model5/)).toBeInTheDocument();
});
it("hides unknown and zero totals", () => {
  const view = render(<><TaskCost card={{ steps: [] } as unknown as BoardCard} /><WorkCost cost={{ todayUsd: 0, weekUsd: 0 }} /></>);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<WorkCost cost={{ todayUsd: 0.001, weekUsd: 1.5 }} />);
  expect(screen.getByText("Today <$0.01 · This week ≈$1.50")).toBeInTheDocument();
});
