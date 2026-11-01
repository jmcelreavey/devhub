export function resolveTerminalUrl(
  configuredUrl: string | null | undefined,
  location: Pick<Location, "protocol" | "hostname">,
  port: string,
  params: URLSearchParams,
  ticket?: string | null,
  ticketPort?: number,
): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const value = configuredUrl?.trim();
  if (!value) {
    const localParams = new URLSearchParams(params);
    if (ticket) localParams.set("ticket", ticket);
    return `${protocol}://${location.hostname}:${port}/?${localParams}`;
  }

  if (!/^wss?:\/\//i.test(value) || value.includes("#")) {
    throw new Error("Invalid terminal URL configuration");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid terminal URL configuration");
  }

  for (const [key, param] of params) {
    url.searchParams.set(key, param);
  }
  // A desktop ticket grants access to the local peer, not an arbitrary configured host.
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  const sameHost = url.hostname === location.hostname ||
    (loopback.includes(url.hostname) && loopback.includes(location.hostname));
  const urlPort = Number(url.port || (url.protocol === "wss:" ? "443" : "80"));
  if (ticket && url.protocol === `${protocol}:` && sameHost && urlPort === ticketPort) {
    url.searchParams.set("ticket", ticket);
  }
  return url.toString();
}
