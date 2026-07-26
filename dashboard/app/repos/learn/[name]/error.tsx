"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the learning pack",
  hint: <>The repo may have moved, or the pack failed to build. Try again, or re-run the scan from the Repos page.</>,
});
