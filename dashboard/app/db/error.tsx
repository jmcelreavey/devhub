"use client";

import { routeError } from "@/components/ui/RouteError";

export default routeError({
  title: "Couldn't open the database workspace",
  hint: (
    <>
      Connections are derived from your access — BI databases need an AWS profile
      signed in on <a href="/ops">Ops</a>, and private hosts need Tailscale up.
      Local SQLite files need neither.
    </>
  ),
});
