"use client";

import { Check } from "lucide-react";
import { GOALS, type GoalId } from "@/lib/setup/goals";

/**
 * "What do you want to use DevHub for?" — the first real question.
 *
 * Multi-select, and skippable: choosing nothing shows every step, which is the
 * old behaviour. This only ever *narrows* what gets offered, and the step rail
 * still reaches everything afterwards, so a wrong answer costs nothing.
 */
export function GoalPicker({
  selected,
  onChange,
}: {
  selected: GoalId[];
  onChange: (next: GoalId[]) => void;
}) {
  function toggle(id: GoalId) {
    // "All of it" is a shortcut for the union, so it doesn't combine with the
    // narrower goals - selecting it replaces them, and vice versa.
    if (id === "everything") {
      onChange(selected.includes("everything") ? [] : ["everything"]);
      return;
    }
    const withoutAll = selected.filter((g) => g !== "everything");
    onChange(
      withoutAll.includes(id) ? withoutAll.filter((g) => g !== id) : [...withoutAll, id],
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {GOALS.map((goal) => {
        const active = selected.includes(goal.id);
        return (
          <button
            key={goal.id}
            type="button"
            onClick={() => toggle(goal.id)}
            aria-pressed={active}
            className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left"
            style={{
              border: `1px solid ${active ? "var(--accent)" : "var(--border-muted)"}`,
              background: active ? "var(--accent-dim)" : "transparent",
            }}
          >
            <span
              aria-hidden
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded"
              style={{
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent)" : "transparent",
              }}
            >
              {active && <Check size={11} style={{ color: "var(--accent-fg)" }} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm" style={{ color: "var(--text)" }}>
                {goal.label}
              </span>
              <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                {goal.description}
              </span>
            </span>
          </button>
        );
      })}
      <p className="mt-1 text-xs" style={{ color: "var(--text-subtle)" }}>
        This only decides what setup offers you. Everything stays available either way, and
        you can change it later.
      </p>
    </div>
  );
}
