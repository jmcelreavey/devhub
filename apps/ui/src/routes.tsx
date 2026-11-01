import type { RouteObject } from "react-router-dom";
import { routes as homeRoutes } from "./routes/home";
import { routes as notesRoutes } from "./routes/notes";
import { routes as docsRoutes } from "./routes/docs";
import { routes as reposRoutes } from "./routes/repos";
import { routes as pluginsRoutes } from "./routes/plugins";
import { routes as setupRoutes } from "./routes/setup";
import { routes as opsRoutes } from "./routes/ops";
import { routes as miscRoutes } from "./routes/misc";

export const routes: RouteObject[] = [
  ...homeRoutes,
  ...notesRoutes,
  ...docsRoutes,
  ...reposRoutes,
  ...pluginsRoutes,
  ...setupRoutes,
  ...opsRoutes,
  ...miscRoutes,
];
