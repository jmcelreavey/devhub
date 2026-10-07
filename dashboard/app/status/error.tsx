"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load system status",
  hint: <>Status polls the Agents (Paseo) daemon, MCP servers and git. One of them may have stopped — the rest of the dashboard is unaffected.</>,
});
