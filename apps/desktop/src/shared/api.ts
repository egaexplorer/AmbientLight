// The contract between the main process and the renderer. Types only, plus the channel names: the renderer reaches the
// main process through `window.ambient` (src/preload), never through Node.js.
import type { GameLookName, LookName, SessionState } from "@ambientlight/core";

export type TitleKind = "film" | "series" | "game";

/** The film or game look in use: picked from a chip, or found from a title. */
export type LookChoice = ({ set: "film"; name: LookName } | { set: "game"; name: GameLookName }) & {
  /** Present when the look came from a title lookup. */
  title?: string;
  genres?: string;
  source?: string;
  url?: string;
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
  onState(listener: (state: AppState) => void): () => void;
  onFrame(listener: (frame: FrameView) => void): () => void;
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
  state: "ambient:state",
  frame: "ambient:frame",
} as const;
