"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load this ownership radar",
  hint: <>The radar needs the <code>gh</code> CLI for pull requests and a local clone for gaps and history — check both on <a href="/setup">Setup</a>.</>,
});
