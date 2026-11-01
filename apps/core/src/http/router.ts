
export interface RouteDefinition {
  pattern: string;
  file: string;
  methods: string[];
  load: () => Promise<object>;
}

type Params = Record<string, string | string[]>;
type Handler = (req: Request, context: { params: Promise<Params> }) => Promise<Response> | Response;

function segmentRank(segment: string): number {
  if (segment.startsWith("[...") || segment.startsWith("[[...")) return 1;
  return segment.startsWith("[") ? 2 : 3;
}

// Next gives static segments priority over dynamic segments and catch-alls.
export function sortRoutes(routes: RouteDefinition[]): RouteDefinition[] {
  return [...routes].sort((a, b) => {
    const left = a.pattern.split("/");
    const right = b.pattern.split("/");
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (right[i] ? segmentRank(right[i]) : 0) - (left[i] ? segmentRank(left[i]) : 0);
      if (difference) return difference;
    }
    return a.pattern.localeCompare(b.pattern);
  });
}

export function matchRoute(pattern: string, pathname: string): Params | null {
  const expected = pattern.split("/").slice(1);
  const actual = pathname.replace(/\/$/, "").split("/").slice(1);
  const params: Params = Object.create(null);
  let index = 0;
  for (const segment of expected) {
    const rest = /^\[\.\.\.(\w+)\]$/.exec(segment);
    const optionalRest = /^\[\[\.\.\.(\w+)\]\]$/.exec(segment);
    if (rest || optionalRest) {
      if (!optionalRest && index === actual.length) return null;
      if (index < actual.length) params[(rest ?? optionalRest)![1]] = actual.slice(index).map(decodeURIComponent);
      index = actual.length;
      break;
    }
    if (index >= actual.length || !actual[index]) return null;
    const dynamic = /^\[(\w+)\]$/.exec(segment);
    if (dynamic) params[dynamic[1]] = decodeURIComponent(actual[index]);
    else if (segment !== actual[index]) return null;
    index++;
  }
  return index === actual.length ? params : null;
}

export async function dispatchRoute(req: Request, routes: RouteDefinition[]): Promise<Response | null> {
  for (const route of routes) {
    const params = matchRoute(route.pattern, new URL(req.url).pathname);
    if (!params) continue;
    const allowed = new Set(route.methods);
    if (allowed.has("GET")) allowed.add("HEAD");
    allowed.add("OPTIONS");
    const allow = [...allowed].sort().join(", ");
    if (req.method === "OPTIONS" && !route.methods.includes("OPTIONS")) return new Response(null, { status: 204, headers: { Allow: allow } });
    const method = req.method === "HEAD" && !route.methods.includes("HEAD") ? "GET" : req.method;
    if (!route.methods.includes(method)) return new Response(null, { status: 405, headers: { Allow: allow } });
    const loaded = await route.load() as Record<string, unknown>;
    const module = typeof loaded[method] === "function" ? loaded : loaded.default as Record<string, unknown> | undefined;
    const handler = module?.[method] as Handler | undefined;
    if (typeof handler !== "function") throw new Error(`Missing ${method} export in ${route.file}`);
    return handler(req, { params: Promise.resolve(params) });
  }
  return null;
}
