"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load notes",
  hint: <>Check that <code>NOTES_DIR</code> resolves to a readable directory.</>,
});
