/** The board menu and task panel describe the same reset operation. */
export function resetTaskConfirmation(discard: boolean) {
  return {
    title: discard ? "Discard work and reset to To do?" : "Reset this task to To do?",
    message: discard
      ? "Runs stop, auto mode is cleared, and the agent checkouts and local agent branches are deleted. A branch already pushed or a PR that's open stays where it is."
      : "Runs stop and auto mode is cleared. The agent checkouts and branches are kept.",
    confirmLabel: discard ? "Discard work and reset" : "Reset to To do",
    variant: discard ? "danger" as const : "default" as const,
  };
}
