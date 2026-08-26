"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the repo",
  hint: <>The local clone may have moved. Try again, or return to the Repos page.</>,
});
