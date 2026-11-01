"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the capability radar",
  hint: <>The radar scans your repos. Re-run the scan, or check the repos directory is readable.</>,
});
