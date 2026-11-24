import {
  discoverBulbs,
  FILM_LOOKS,
  type FrameReport,
  GAME_LOOKS,
  identifyBulb,
  type ScreenCapturer,
  SyncSession,
  type UdpSocket,
  WizLight,
} from "@ambientlight/core";
import {
  type AppConfig,
  type ChosenLook,
  errorMessage,
  syncOptionsFor,
  TitleError,
  type TitleInfo,
  UserError,
} from "@ambientlight/node";
import type {
  AppState,
  DiscoverResult,
  FrameView,
  IdentifyOutcome,
  LookChoice,
  TitleKind,
  TitleResult,
} from "../shared/api";
import { FrameViews } from "./frame-view";

/** Everything the controller needs from Electron, Node.js and the network, so tests can fake it. */
export interface Platform {
  loadConfig(): AppConfig;
  saveConfig(config: AppConfig): AppConfig;
  createSocket(options?: { broadcast?: boolean }): Promise<UdpSocket>;
  createCapturer(config: AppConfig): ScreenCapturer;
  broadcastAddresses(): string[];
  lookForTitle(kind: TitleKind, title: string): Promise<ChosenLook & { info: TitleInfo }>;
  now(): number;
  /** How long discovery listens, in ms. */
  discoverMs?: number;
}

export interface ControllerEvents {
  state(state: AppState): void;
  frame(frame: FrameView): void;
  /** Every frame, unthrottled (for the verbose log). */
  report?(report: FrameReport): void;
}

/** A problem from the sync loop stays on screen this long after the last time it happened. */
const ERROR_HOLD_MS = 3000;

/**
 * The desktop app's state in the main process: the config, the chosen look and one `SyncSession`. Every IPC call
 * ends up here; Electron itself stays in `index.ts`.
 */
export class AppController {
  private readonly platform: Platform;
  private readonly events: ControllerEvents;
  private config: AppConfig;
  private look: LookChoice | null = null;
  private session: SyncSession | undefined;
  private capturer: ScreenCapturer | undefined;
  private socket: UdpSocket | undefined;
  private error: string | null = null;
  private errorAt = Number.NEGATIVE_INFINITY;
  private notRestored: string[] = [];
  private views: FrameViews | undefined;

  constructor(platform: Platform, events: ControllerEvents) {
    this.platform = platform;
    this.events = events;
    this.config = platform.loadConfig();
  }

  getState(): AppState {
    return {
      bulbs: [...this.config.bulbs],
      sync: this.session?.state ?? "idle",
      look: this.look,
      error: this.error,
      notRestored: [...this.notRestored],
      brightness: this.config.brightness,
      brightnessCap: Math.round(this.syncOptions().calibration?.maxDimming ?? this.config.calibration.maxDimming),
    };
  }

  async discover(): Promise<DiscoverResult> {
    const via = this.platform.broadcastAddresses();
    const socket = await this.platform.createSocket({ broadcast: true });
    try {
      const found = await discoverBulbs(socket, {
        broadcastAddresses: via,
        timeoutMs: this.platform.discoverMs ?? 2000,
      });
      return {
        via,
        bulbs: found.map((bulb) => ({
          ip: bulb.address,
          ...(bulb.mac !== undefined ? { mac: bulb.mac } : {}),
          ...(bulb.rssi !== undefined ? { rssi: bulb.rssi } : {}),
          on: bulb.state.state !== false,
        })),
      };
    } finally {
      await socket.close();
    }
  }

  async identify(ip: string): Promise<IdentifyOutcome> {
    if (this.session && this.session.state !== "idle" && this.config.bulbs.includes(ip)) {
      return { ok: false, message: "Stop syncing first: the sync would cover the blink." };
    }
    try {
      const result = await identifyBulb(new WizLight(ip, await this.sharedSocket()));
      return result.restored ? { ok: true } : { ok: true, message: "The bulb blinked, but didn't confirm getting its color back." };
    } catch (error) {
      return { ok: false, message: `No answer from ${ip} (${errorMessage(error)})` };
    }
  }

  /** Saves the bulb list. While syncing, the old bulbs are restored and the new ones take over. */
  async setBulbs(ips: string[]): Promise<AppState> {
    const wasRunning = this.isRunning();
    if (wasRunning) await this.stopSync();
    this.config = this.platform.saveConfig({ ...this.config, bulbs: [...ips] });
    if (wasRunning && ips.length > 0) return this.startSync();
    return this.publish();
  }

  async findTitle(kind: TitleKind, title: string): Promise<TitleResult> {
    try {
      const chosen = await this.platform.lookForTitle(kind, title);
      const { info } = chosen;
      const found = { title: info.title, genres: info.genres, source: info.source, url: info.url };
      const look: LookChoice =
        chosen.set === "game" ? { set: "game", name: chosen.name, ...found } : { set: "film", name: chosen.name, ...found };
      await this.setLook(look);
      return { ok: true, look };
    } catch (error) {
      if (error instanceof TitleError) {
        return {
          ok: false,
          code: error.code,
          message: error.message,
          similar: error.similar,
          ...(error.retryAfterS !== undefined ? { retryAfterS: error.retryAfterS } : {}),
        };
      }
      return { ok: false, code: "error", message: errorMessage(error), similar: [] };
    }
  }

  /** Sets the film or game look; while syncing it applies at once. */
  async setLook(look: LookChoice | null): Promise<AppState> {
    this.look = look;
    if (this.session) await this.session.update({ sync: this.syncOptions() });
    return this.publish();
  }

  /** Saves the brightness setting; while syncing it applies at once. */
  async setBrightness(value: number): Promise<AppState> {
    this.config = this.platform.saveConfig({ ...this.config, brightness: value });
    if (this.session) await this.session.update({ sync: this.syncOptions() });
    return this.publish();
  }

  async startSync(): Promise<AppState> {
    if (this.isRunning()) return this.getState();
    if (this.config.bulbs.length === 0) throw new UserError("Add a bulb first: press Find bulbs.");
    this.error = null;
    this.notRestored = [];
    try {
      const socket = await this.sharedSocket();
      this.capturer = this.platform.createCapturer(this.config);
      this.views = new FrameViews(() => this.platform.now(), this.config.calibration.paleWhite);
      this.session = new SyncSession(
        {
          capturer: this.capturer,
          lights: this.config.bulbs.map((ip) => new WizLight(ip, socket)),
          sync: this.syncOptions(),
          restoreOnExit: this.config.restoreOnExit,
        },
        {
          onFrame: (report) => {
            this.events.report?.(report);
            if (this.error !== null && this.platform.now() - this.errorAt > ERROR_HOLD_MS) {
              this.error = null;
              this.publish();
            }
            const view = this.views?.next(report);
            if (view) this.events.frame(view);
          },
          onError: (error) => this.reportError(error),
          onState: () => this.publish(),
          onRestoreUnavailable: (host) => {
            this.notRestored.push(host);
          },
        },
      );
      await this.session.start();
    } catch (error) {
      await this.closeCapturer();
      this.session = undefined;
      throw error;
    }
    return this.publish();
  }

  async stopSync(): Promise<AppState> {
    const session = this.session;
    if (!session) return this.getState();
    await session.stop();
    this.session = undefined;
    this.views = undefined;
    await this.closeCapturer();
    return this.publish();
  }

  /** Restores the bulbs and releases the capture helper and the socket. Call before the app quits. */
  async shutdown(): Promise<void> {
    await this.stopSync();
    await this.socket?.close();
    this.socket = undefined;
  }

  isRunning(): boolean {
    return this.session !== undefined && this.session.state !== "idle";
  }

  private syncOptions() {
    const look = this.look;
    if (!look) return syncOptionsFor(this.config);
    return syncOptionsFor(this.config, look.set === "game" ? GAME_LOOKS[look.name] : FILM_LOOKS[look.name]);
  }

  private async sharedSocket(): Promise<UdpSocket> {
    this.socket ??= await this.platform.createSocket();
    return this.socket;
  }

  private async closeCapturer(): Promise<void> {
    const capturer = this.capturer;
    this.capturer = undefined;
    await capturer?.close?.();
  }

  /** Shows a sync-loop problem without re-sending the state for every frame that fails the same way. */
  private reportError(error: unknown): void {
    const message = errorMessage(error);
    const changed = message !== this.error;
    this.error = message;
    this.errorAt = this.platform.now();
    if (changed) this.publish();
  }

  private publish(): AppState {
    const state = this.getState();
    this.events.state(state);
    return state;
  }
}
