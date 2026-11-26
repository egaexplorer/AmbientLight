// The contract between the main process and the renderer. Types only, plus the channel names: the renderer reaches the
// main process through `window.ambient` (src/preload), never through Node.js.
import type { GameLookName, LookName, LookTuning, SessionState } from "@ambientlight/core";

export type TitleKind = "film" | "series" | "game";

/** How an AI nudged a title's look (steps −2 to +2), and why. */
export type LookTuningView = LookTuning & {
  /** One English sentence from the AI. */
  reason: string;
  /** The model, e.g. "Gemini (gemini-3.5-flash-lite)". */
  by: string;
};

/** The film or game look in use: picked from a chip, or found from a title. */
export type LookChoice = ({ set: "film"; name: LookName } | { set: "game"; name: GameLookName }) & {
  /** Present when the look came from a title lookup. */
  title?: string;
  genres?: string;
  source?: string;
  url?: string;
  /** Present when an AI tuned the look for the title; the genre look is used as it is otherwise. */
  tuning?: LookTuningView;
  /** Why the AI didn't tune the title's look (it failed, or the source had no summary). Absent without a key. */
  aiError?: string;
};

export interface BulbInfo {
  ip: string;
  mac?: string;
  rssi?: number;
  /** Power as the bulb reported it during discovery. */
  on?: boolean;
}

export interface AppState {
  /** Configured bulb IPs. */
  bulbs: string[];
  sync: SessionState;
  look: LookChoice | null;
  /** The latest problem worth showing (capture, network), or null. */
  error: string | null;
  /** Bulbs that couldn't be read at start, so they won't be restored. */
  notRestored: string[];
  /** The brightness setting, 10–100: 70 shows the look (or plain sync) as designed. */
  brightness: number;
  /** The bulb's top brightness in % that the setting gives with the current look, rounded. */
  brightnessCap: number;
}

/** One live update for the Home screen (about 10 a second while syncing). */
export interface FrameView {
  /** Screen average, as #rrggbb. */
  screen: string;
  /** The color the hue comes from. */
  hue: string;
  /** What the bulb shows, as #rrggbb (white LEDs drawn at their color temperature). */
  bulb: string;
  /** e.g. "dim 15 %" or "white 5000 K · dim 40 %". */
  bulbText: string;
  fps: number;
  captureMs: number;
  /** Share of frames sent to the bulbs since the start, 0–1. */
  sentShare: number;
  cut: boolean;
}

export interface DiscoverResult {
  bulbs: BulbInfo[];
  /** Broadcast addresses that were searched. */
  via: string[];
}

export type TitleErrorCode = "no-title" | "offline" | "rate-limited" | "http" | "unreadable" | "refused" | "not-found" | "no-genre" | "error";

export type TitleResult =
  | { ok: true; look: LookChoice }
  | { ok: false; code: TitleErrorCode; message: string; similar: string[]; retryAfterS?: number };

export interface IdentifyOutcome {
  ok: boolean;
  /** Why it failed, when it did. */
  message?: string;
}

/** Which looks the shortcut keys pick from. */
export type LookSet = LookChoice["set"];

/** What a global shortcut can do; also the keys of `shortcuts.json`. */
export type ShortcutAction =
  | "nextLook"
  | "previousLook"
  | "noLook"
  | "look1"
  | "look2"
  | "look3"
  | "look4"
  | "look5"
  | "look6"
  | "look7"
  | "look8"
  | "switchSet"
  | "toggleSync"
  | "brighter"
  | "dimmer";

/** "taken": another program holds the keys; "invalid": not keys Electron understands; "off": null in the file. */
export type ShortcutStatus = "on" | "off" | "taken" | "invalid";

export interface ShortcutsView {
  /** Where the keys are set: `shortcuts.json` next to the config. */
  file: string;
  /** Why the file couldn't be used (the defaults apply then), or null. */
  error: string | null;
  keys: Array<{ action: ShortcutAction; accelerator: string | null; status: ShortcutStatus }>;
}

/** What the popup shows after a shortcut, worded by the renderer. */
export type Toast =
  | { kind: "look"; look: LookChoice | null; set: LookSet }
  | { kind: "set"; set: LookSet }
  | { kind: "sync"; on: boolean }
  | { kind: "brightness"; value: number; cap: number }
  | { kind: "error"; message: string };

/** What the preload exposes as `window.ambient`. */
export interface AmbientApi {
  getState(): Promise<AppState>;
  discover(): Promise<DiscoverResult>;
  identify(ip: string): Promise<IdentifyOutcome>;
  setBulbs(ips: string[]): Promise<AppState>;
  findTitle(kind: TitleKind, title: string): Promise<TitleResult>;
  setLook(look: LookChoice | null): Promise<AppState>;
  /** Saves the brightness setting (10–100); applies at once while syncing. */
  setBrightness(value: number): Promise<AppState>;
  startSync(): Promise<AppState>;
  stopSync(): Promise<AppState>;
  minimizeWindow(): Promise<void>;
  /** The global shortcut keys and whether each one could be registered. */
  getShortcuts(): Promise<ShortcutsView>;
  /** Reads `shortcuts.json` again and registers its keys. */
  reloadShortcuts(): Promise<ShortcutsView>;
  /** Opens `shortcuts.json` in the default editor. */
  openShortcutsFile(): Promise<void>;
  onState(listener: (state: AppState) => void): () => void;
  onFrame(listener: (frame: FrameView) => void): () => void;
  /** The popup window's content after a shortcut. */
  onToast(listener: (toast: Toast) => void): () => void;
}

export const CHANNELS = {
  getState: "ambient:get-state",
  discover: "ambient:discover",
  identify: "ambient:identify",
  setBulbs: "ambient:set-bulbs",
  findTitle: "ambient:find-title",
  setLook: "ambient:set-look",
  setBrightness: "ambient:set-brightness",
  startSync: "ambient:start-sync",
  stopSync: "ambient:stop-sync",
  minimizeWindow: "ambient:minimize-window",
  getShortcuts: "ambient:get-shortcuts",
  reloadShortcuts: "ambient:reload-shortcuts",
  openShortcutsFile: "ambient:open-shortcuts-file",
  state: "ambient:state",
  frame: "ambient:frame",
  toast: "ambient:toast",
} as const;
