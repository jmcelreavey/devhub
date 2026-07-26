"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load learnings",
  hint: <>Check the notes directory is readable.</>,
});
