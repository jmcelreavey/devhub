"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open agent chats",
  hint: <>Runs live under DEVHUB_AGENT_RUNS_DIR and MCP calls under ~/.local/state/devhub/mcp-history — check both are readable.</>,
});
