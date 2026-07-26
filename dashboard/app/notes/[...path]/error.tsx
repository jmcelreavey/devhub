"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load this note",
  hint: <>The file may have been moved or deleted outside the app. Try the Library index.</>,
});
