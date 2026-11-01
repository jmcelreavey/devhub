"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load Recall",
  hint: <>The index lives under the notes directory — check it is readable, then rebuild.</>,
});
