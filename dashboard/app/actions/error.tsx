"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load actions",
  hint: <>Actions run local scripts. Check the scripts directory is readable.</>,
});
