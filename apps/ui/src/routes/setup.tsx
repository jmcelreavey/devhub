import { createElement } from "react";
import type { RouteObject } from "react-router-dom";
import { SetupRoute, StatusRoute } from "../views/setup/SettingsRoutes";

export const routes: RouteObject[] = [
  { path: "/setup", element: createElement(SetupRoute) },
  { path: "/status", element: createElement(StatusRoute) },
];
