"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't build the briefing",
  hint: <>The briefing pulls calendar, tasks and feeds, and uses the AI provider for prose. Check <code>AI_API_KEY</code> and your integrations on <a href="/setup">Setup</a>.</>,
});
