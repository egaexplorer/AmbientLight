import type { AmbientApi, AppState, FrameView, LookChoice } from "../../shared/api";

/**
 * A stand-in for the main process, so the renderer can be developed and screenshotted in a browser without Windows
 * or a bulb. Its colors are made up; nothing here talks to a network.
 */
export function createMockApi(): AmbientApi {
  let state: AppState = { bulbs: ["192.168.1.50"], sync: "idle", look: null, error: null, notRestored: [] };
  const stateListeners = new Set<(s: AppState) => void>();
  const frameListeners = new Set<(f: FrameView) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const set = (patch: Partial<AppState>): AppState => {
    state = { ...state, ...patch };
    for (const l of stateListeners) l(state);
    return state;
  };

  const palette = [
    ["#171210", "#b05a2a", "#ff7a2e"],
    ["#0e1a2b", "#2a5db0", "#3d7bff"],
    ["#1d2a1a", "#5a8a3a", "#8fd16a"],
  ] as const;

  return {
    getState: async () => state,
    discover: async () => {
      await wait(800);
      return { via: ["192.168.1.255"], bulbs: [{ ip: "192.168.1.50", mac: "a8bb50c0ffee", rssi: -58, on: true }] };
    },
    identify: async () => {
      await wait(1400);
      return { ok: true };
    },
    setBulbs: async (ips) => set({ bulbs: ips }),
    findTitle: async (kind, title) => {
      await wait(500);
      if (/setan|satan/i.test(title)) {
        const look: LookChoice = {
          name: "horror",
          title: "Satan's Slaves",
          genres: "2017 Indonesian supernatural horror",
          source: "Wikipedia (CC BY-SA 4.0)",
          url: "https://en.wikipedia.org/",
        };
        set({ look });
        return { ok: true, look };
      }
      return { ok: false, code: "not-found", message: `No ${kind} called "${title}" found.`, similar: [] };
    },
    setLook: async (look) => set({ look }),
    startSync: async () => {
      if (state.bulbs.length === 0) throw new Error("Add a bulb first: press Find bulbs.");
      set({ sync: "starting" });
      await wait(300);
      tick = 0;
      timer = setInterval(() => {
        tick++;
        const [screen, hue, bulb] = palette[Math.floor(tick / 30) % palette.length]!;
        const frame: FrameView = {
          screen,
          hue,
          bulb,
          bulbText: "dim 15 %",
          fps: 20,
          captureMs: 32,
          sentShare: 0.14,
          cut: tick % 30 === 0,
        };
        for (const l of frameListeners) l(frame);
      }, 100);
      return set({ sync: "running" });
    },
    stopSync: async () => {
      set({ sync: "stopping" });
      clearInterval(timer);
      await wait(200);
      return set({ sync: "idle" });
    },
    minimizeWindow: async () => undefined,
    onState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onFrame: (listener) => {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
  };
}
