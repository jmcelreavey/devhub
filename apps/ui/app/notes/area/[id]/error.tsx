"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open this area",
  hint: <>Areas are folders in your notes vault. The folder may have been renamed or moved.</>,
});
