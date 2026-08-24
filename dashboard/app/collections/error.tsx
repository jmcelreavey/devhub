"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load collections",
  hint: <>Collections are read from your notes vault. Check the vault path under Setup → Content.</>,
});
