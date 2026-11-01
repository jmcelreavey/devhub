export interface DesktopNavigation {
  href: string;
  newTab: true;
}

type DesktopNavigationListener = (navigation: DesktopNavigation) => void;

interface DesktopNavigationState {
  listeners: Set<DesktopNavigationListener>;
}

const GLOBAL_KEY = Symbol.for("devhub.desktop.navigation");

function state(): DesktopNavigationState {
  const globalState = globalThis as unknown as Record<symbol, DesktopNavigationState | undefined>;
  if (!globalState[GLOBAL_KEY]) {
    globalState[GLOBAL_KEY] = { listeners: new Set() };
  }
  return globalState[GLOBAL_KEY];
}

export function subscribeToDesktopNavigation(listener: DesktopNavigationListener): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}

export function publishDesktopNavigation(navigation: DesktopNavigation): number {
  let delivered = 0;
  for (const listener of state().listeners) {
    try {
      listener(navigation);
      delivered += 1;
    } catch {
      state().listeners.delete(listener);
    }
  }
  return delivered;
}
