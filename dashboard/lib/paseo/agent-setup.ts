import { isDesktopRuntime } from "@/lib/desktop/runtime-paths";
import { DEPENDENCIES, probeDependency } from "@/lib/setup/dependencies";
import { agentBlocker, agentSetupMessage, type AgentBlocker, type AgentPrerequisites } from "./prerequisites";

function present(id: string): boolean {
  const spec = DEPENDENCIES.find((tool) => tool.id === id);
  return spec ? probeDependency(spec).present : false;
}

export function describeAgentSetup(paseoRunning: boolean): ReturnType<typeof agentSetupMessage> & { blocker: AgentBlocker } {
  const input: AgentPrerequisites = {
    node: present("node"),
    npm: present("npm"),
    safeChain: present("safe-chain"),
    paseoRunning,
  };
  return { ...agentSetupMessage(input, { checkout: !isDesktopRuntime() }), blocker: agentBlocker(input) };
}
