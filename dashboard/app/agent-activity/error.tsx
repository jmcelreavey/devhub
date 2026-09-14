"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load agent activity",
  hint: <>Runs live under DEVHUB_AGENT_RUNS_DIR and MCP calls under ~/.local/state/devhub/mcp-history — check both are readable.</>,
});
