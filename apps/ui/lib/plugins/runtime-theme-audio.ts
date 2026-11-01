import { effectEnabled, type ThemeEffectPreferences } from "../theme-effects";
import { runtimeThemeAssetUrl, type PublicRuntimeTheme } from "../../../../packages/shared/ui-lib/plugins/runtime-theme-contract";

/** Audio stays in core so a frame message cannot manufacture user activation. */
export function runtimeThemeAudio(theme: PublicRuntimeTheme, failed: () => void) {
  const nodes = new Map<string, HTMLAudioElement>();
  const timers = new Map<string, number>();
  const primed = new Set<string>();
  const priming = new Map<string, symbol>();
  let allowed = false;
  let activated = false;
  let awaitingGesture = false;
  let disposed = false;
  let requests: number[] = [];
  function stop(id?: string) {
    for (const [key, timer] of timers) {
      if (id && key !== id) continue;
      window.clearTimeout(timer);
      timers.delete(key);
    }
    for (const [key, node] of nodes) {
      if (id && key !== id) continue;
      priming.delete(key);
      node.pause();
      node.currentTime = 0;
    }
  }
  function audioNode(sound: NonNullable<PublicRuntimeTheme["audio"]>[number]) {
    const id = sound.id;
    let node = nodes.get(id);
    if (!node) {
      node = new Audio(runtimeThemeAssetUrl(theme, `audio:${id}`));
      node.preload = "none";
      node.volume = sound.volume;
      node.loop = sound.loop;
      nodes.set(id, node);
    }
    return node;
  }
  function play(id: string) {
    if (!allowed || !activated || disposed) return;
    const sound = theme.audio?.find(sound => sound.id === id);
    if (!sound) return;
    const node = audioNode(sound);
    if (!node.paused) return;
    if (sound.rate) node.playbackRate = sound.rate[0] + Math.random() * (sound.rate[1] - sound.rate[0]);
    void node.play().catch(() => { if (!disposed && allowed) failed(); });
  }
  function scheduleRandom(sound: NonNullable<PublicRuntimeTheme["audio"]>[number], initial: boolean) {
    if (!allowed || !activated || disposed || !sound.schedule || !primed.has(sound.id) || timers.has(sound.id)) return;
    const { initialMin, initialMax, min, max } = sound.schedule;
    const low = initial ? initialMin : min, high = initial ? initialMax : max;
    const timer = window.setTimeout(() => {
      timers.delete(sound.id);
      play(sound.id);
      scheduleRandom(sound, false);
    }, (low + Math.random() * (high - low)) * 1000);
    timers.set(sound.id, timer);
  }
  function primeRandom(sound: NonNullable<PublicRuntimeTheme["audio"]>[number]) {
    if (!allowed || !activated || disposed || priming.has(sound.id)) return;
    if (primed.has(sound.id)) { scheduleRandom(sound, true); return; }
    const node = audioNode(sound);
    const token = Symbol(sound.id);
    node.muted = true;
    priming.set(sound.id, token);
    void node.play().then(() => {
      if (priming.get(sound.id) !== token) return;
      node.pause();
      node.currentTime = 0;
      node.muted = false;
      priming.delete(sound.id);
      if (disposed) return;
      primed.add(sound.id);
      scheduleRandom(sound, true);
    }).catch(() => {
      if (priming.get(sound.id) !== token) return;
      priming.delete(sound.id);
      node.muted = false;
      if (!disposed && allowed) failed();
    });
  }
  function ambient() {
    for (const sound of theme.audio ?? []) if (sound.trigger === "ambient") play(sound.id);
    for (const sound of theme.audio ?? []) if (sound.trigger === "random") primeRandom(sound);
  }
  function gestureSounds() {
    if (!allowed || !activated || !awaitingGesture || disposed) return;
    awaitingGesture = false;
    for (const sound of theme.audio ?? []) if (sound.trigger === "gesture") play(sound.id);
  }
  return {
    configure(preferences: ThemeEffectPreferences, motion: boolean, visible: boolean, userGesture = false) {
      const nextAllowed = visible && effectEnabled(theme.id, preferences, "sound", motion);
      if (!nextAllowed) { allowed = false; awaitingGesture = false; if (!preferences.master || !preferences.sound) activated = false; stop(); return; }
      if (!allowed) awaitingGesture = true;
      allowed = true;
      if (userGesture) activated = true;
      ambient();
      if (userGesture) gestureSounds();
    },
    gesture(event: Event) {
      if (!allowed || !event.isTrusted || disposed || (navigator.userActivation && !navigator.userActivation.isActive)) return;
      activated = true;
      ambient();
      if (event.target instanceof Element && event.target.closest("button.theme-effect-toggle")) return;
      if (event.type === "keydown") {
        const key = event as KeyboardEvent;
        if (key.repeat || !["Enter", " "].includes(key.key)) return;
      }
      gestureSounds();
    },
    request(id: string, action: "play" | "stop") {
      if (!theme.audio?.some(sound => sound.id === id && (sound.trigger === "effect" || sound.trigger === "ambient"))) return;
      if (action === "stop") { stop(id); return; }
      const now = performance.now();
      requests = requests.filter(time => now - time < 1000);
      if (requests.length >= 4) return;
      requests.push(now);
      play(id);
    },
    dispose() {
      disposed = true;
      stop();
      for (const node of nodes.values()) { node.removeAttribute("src"); node.load(); }
      nodes.clear();
    },
  };
}
