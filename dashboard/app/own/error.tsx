"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load owned repositories",
  hint: <>Ownership reads GitHub through the <code>gh</code> CLI — check it is installed and authenticated on <a href="/setup">Setup</a>.</>,
});
