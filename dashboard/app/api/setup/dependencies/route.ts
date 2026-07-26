import { NextRequest, NextResponse } from "next/server";
import { DEPENDENCIES, checkDependencies } from "@/lib/setup/dependencies";
import { isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { isGoalId, type GoalId } from "@/lib/setup/goals";

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
export const dynamic = "force-dynamic";

/** Goals that involve the user's repositories, and therefore need Git. */
const CODE_GOALS: readonly GoalId[] = ["code", "everything"];

export async function GET(req: NextRequest) {
  const goals = (req.nextUrl.searchParams.get("goals") ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(isGoalId);

  const codeGoals = goals.length === 0 || goals.some((g) => CODE_GOALS.includes(g));

  return NextResponse.json(
    checkDependencies(DEPENDENCIES, { desktop: isDesktopRuntime(), codeGoals }),
  );
}
