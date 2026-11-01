import { setupDependencies } from "../../../../../../../packages/shared/actions/setup";
import { DEPENDENCIES, checkDependencies } from "../../../../lib/setup/dependencies";
import { clearGitAvailabilityCache } from "../../../../lib/setup/git-availability";
import { isDesktopRuntime } from "../../../../lib/desktop/runtime-paths";
import { isGoalId, type GoalId } from "../../../../../../../packages/shared/ui-lib/setup/goals";

/**
 * Which external tools are actually installed. Read-only.
 *
 * Each probe spawns the binary with a short timeout, so this is deliberately
 * not called on every page - only the setup screen asks for it.
 *
 * `?goals=code,notes` narrows what counts as *required*. Without it, everything
 * that could ever be required is — which is what this route did before goals
 * existed and is still the right default for a caller that passes nothing.
 */


/** Goals that involve the user's repositories, and therefore need Git. */
const CODE_GOALS: readonly GoalId[] = ["code", "everything"];

export async function GET(req: Request) {
  const goals = new URL(req.url).searchParams.get("goals");
  return await setupDependencies.handler({ goals }, { execute: ({ goals: selectedGoals }) => checkGoals(selectedGoals) }) as Response;
}

async function checkGoals(selectedGoals: string | null) {
  const parsedGoals = (selectedGoals ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(isGoalId);

  const codeGoals = parsedGoals.length === 0 || parsedGoals.some((g) => CODE_GOALS.includes(g));
  clearGitAvailabilityCache();

  return Response.json(
    await checkDependencies(DEPENDENCIES, { desktop: isDesktopRuntime(), codeGoals }),
  );
}
