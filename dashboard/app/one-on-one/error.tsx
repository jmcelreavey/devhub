"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load 1:1 notes",
  hint: <>Check the notes directory is readable.</>,
});
