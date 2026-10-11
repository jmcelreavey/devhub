"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load the changelog",
  hint: <>Release notes are bundled with this build. Try again, or copy the details below.</>,
});
