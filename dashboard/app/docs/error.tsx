"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load docs",
  hint: <>Check that <code>DOCS_DIR</code> resolves to a readable directory.</>,
});
