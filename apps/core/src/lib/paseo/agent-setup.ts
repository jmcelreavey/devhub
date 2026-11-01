import { isDesktopRuntime } from "../desktop/runtime-paths";
import { DEPENDENCIES, probeDependency } from "../setup/dependencies";
import { agentBlocker, agentSetupMessage, type AgentBlocker, type AgentPrerequisites } from "../../../../../packages/shared/ui-lib/paseo/prerequisites";

async function present(id: string): Promise<boolean> {
  const spec = DEPENDENCIES.find((tool) => tool.id === id);
  return spec ? (await probeDependency(spec)).present : false;
}

export async function describeAgentSetup(paseoRunning: boolean): Promise<ReturnType<typeof agentSetupMessage> & { blocker: AgentBlocker }> {
  const input: AgentPrerequisites = {
    node: await present("node"),
    npm: await present("npm"),
    paseoRunning,
  };
  return { ...agentSetupMessage(input, { checkout: !isDesktopRuntime(), packaged: isDesktopRuntime() }), blocker: agentBlocker(input) };
}
