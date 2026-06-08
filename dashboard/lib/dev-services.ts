/** Browser-safe registry — no process.env here. Runtime values come from env vars in callers. */
export interface DevService {
  id: string;
  label: string;
  route: string;
  icon: string;
  defaultPort: number;
  portEnvKey: string;
  hostEnvKey: string;
  iframeTitle: string;
}

export const DEV_SERVICES: DevService[] = [
  {
    id: "openchamber",
    label: "OpenChamber",
    route: "/chamber",
    icon: "chamber",
    defaultPort: 1336,
    portEnvKey: "OPENCHAMBER_PORT",
    hostEnvKey: "OPENCHAMBER_HOST",
    iframeTitle: "OpenChamber",
  },
  {
    id: "opencode",
    label: "OpenCode",
    route: "/opencode",
    icon: "opencode",
    defaultPort: 1338,
    portEnvKey: "OPENCODE_PORT",
    hostEnvKey: "OPENCODE_BIND_HOST",
    iframeTitle: "OpenCode",
  },
];
