"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't load system status",
  hint: <>Status polls the peer services (OpenChamber, OpenCode, terminal). One of them may have stopped — the rest of the dashboard is unaffected.</>,
});
