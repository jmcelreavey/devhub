"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open this diagram",
  hint: <>The file may be missing or its snapshot may be from an incompatible tldraw version.</>,
});
