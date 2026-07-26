"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load research",
  hint: <>Research uses the AI provider. Check <code>AI_API_KEY</code> is set on <a href="/setup">Setup</a>.</>,
});
