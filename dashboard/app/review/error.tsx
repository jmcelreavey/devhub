"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load review",
  hint: <>Review hands off to the agent CLI. Check it is configured under Skills → Agent CLI.</>,
});
