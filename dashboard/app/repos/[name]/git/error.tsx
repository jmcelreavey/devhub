"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Git",
  hint: <>The local clone may have moved. Try again, or return to the repo.</>,
});
