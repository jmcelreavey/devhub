"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Search failed",
  hint: <>The index may be mid-write. Try again; if it persists, check that the content directories are readable.</>,
});
