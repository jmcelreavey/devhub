"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the weekly review",
  hint: <>Weekly review hands off to the agent CLI. Check it is configured under Agent skills → Agent CLI.</>,
});
