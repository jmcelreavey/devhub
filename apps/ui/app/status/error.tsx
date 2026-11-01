"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Settings",
  hint: <>Try again, or open the original page directly. For status, check the Agents (Paseo) daemon, MCP servers and git.</>,
});
