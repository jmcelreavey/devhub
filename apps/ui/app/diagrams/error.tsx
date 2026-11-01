"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load diagrams",
  hint: <>Diagrams are stored as tldraw files on disk. Check the diagrams directory is readable.</>,
});
