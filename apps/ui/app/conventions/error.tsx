"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Conventions",
  hint: <>Rules are stored under the notes directory in <code>.config/conventions</code> — check it is readable.</>,
});
