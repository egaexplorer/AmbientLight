import { DESIGN_BRIGHTNESS } from "@ambientlight/core";
import type { AmbientApi, AppState, FrameView, LookChoice, ShortcutsView } from "../../shared/api";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from "../../shared/shortcuts";
import { lookOf } from "./model/looks";

/** The top brightness the main process would report (default calibration: 10–100 %). */
function capFor(brightness: number, look: LookChoice | null): number {
  const design = look ? lookOf(look).maxDimming : 100;
  return Math.round(Math.min(100, Math.max(10, (design * brightness) / DESIGN_BRIGHTNESS)));
}

/**
 * A stand-in for the main process, so the renderer can be developed and screenshotted in a browser without Windows
 * or a bulb. Its colors are made up; nothing here talks to a network.
 */
export function createMockApi(): AmbientApi {
  let state: AppState = {
    bulbs: ["192.168.1.50"],
    sync: "idle",
    look: null,
    error: null,
    notRestored: [],
    brightness: DESIGN_BRIGHTNESS,
    brightnessCap: 100,
  };
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

  // One key shows as taken, so the dialog's warning can be looked at.
  const shortcuts: ShortcutsView = {
    file: "C:\\Users\\you\\AppData\\Roaming\\AmbientLight\\shortcuts.json",
    error: null,
    keys: SHORTCUT_ACTIONS.map((action) => ({
      action,
      accelerator: DEFAULT_SHORTCUTS[action],
      status: action === "toggleSync" ? "taken" : "on",
    })),
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
      const source = { source: "Wikipedia (CC BY-SA 4.0)", url: "https://en.wikipedia.org/" };
      let look: LookChoice | undefined;
      if (kind !== "game" && /setan|satan/i.test(title)) {
        look = {
          set: "film",
          name: "horror",
          title: "Satan's Slaves",
          genres: "2017 Indonesian supernatural horror",
          ...source,
          tuning: {
            brightness: -1,
            warmth: 0,
            vividness: -1,
            reason: "A family haunted in a remote house after the mother's death: darker and more muted.",
            by: "Gemini (mock)",
          },
        };
      } else if (kind === "game" && /dreadout/i.test(title)) {
        look = { set: "game", name: "horror", title: "DreadOut", genres: "2014 survival horror", ...source };
      } else if (kind === "game" && /valorant/i.test(title)) {
        look = { set: "game", name: "shooter", title: "Valorant", genres: "2020 first-person tactical hero shooter", ...source };
      }
      if (look) {
        set({ look, brightnessCap: capFor(state.brightness, look) });
        return { ok: true, look };
      }
      return { ok: false, code: "not-found", message: `No ${kind} called "${title}" found.`, similar: [] };
    },
    setLook: async (look) => set({ look, brightnessCap: capFor(state.brightness, look) }),
    setBrightness: async (brightness) => set({ brightness, brightnessCap: capFor(brightness, state.look) }),
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
    getShortcuts: async () => shortcuts,
    reloadShortcuts: async () => shortcuts,
    openShortcutsFile: async () => {
      throw new Error("The browser preview can't open files.");
    },
    // The browser preview has no global keys, so no popup.
    onToast: () => () => undefined,
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
