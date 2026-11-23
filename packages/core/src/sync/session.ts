import { type Clock, systemClock } from "../platform/timers.js";
import type { WizLight } from "../wiz/light.js";
import { pilotToRestoreParams, type SetPilotParams } from "../wiz/protocol.js";
import { type FrameReport, SyncEngine, type SyncOptions } from "./engine.js";
import type { ScreenCapturer } from "./types.js";

/** `idle` → `starting` → `running` → `stopping` → `idle`. */
export type SessionState = "idle" | "starting" | "running" | "stopping";

export interface SyncSessionOptions {
  capturer: ScreenCapturer;
  lights: readonly WizLight[];
  sync?: Partial<SyncOptions>;
  /** Read each bulb's state before syncing and put it back on `stop()`. Default true. */
  restoreOnExit?: boolean;
  clock?: Clock;
}

export interface SyncSessionEvents {
  onFrame?(report: FrameReport): void;
  onError?(error: unknown): void;
  onState?(state: SessionState): void;
  /** The bulb's state couldn't be read at start, so it won't be restored on stop. */
  onRestoreUnavailable?(host: string, error: unknown): void;
}

export interface StopResult {
  /** Bulbs that were sent their previous state. */
  restored: string[];
}

/**
 * One sync run for an app: reads the bulbs' states, runs a `SyncEngine`, applies option changes while running, and
 * restores the bulbs on stop. Calls are queued, so a double click on Start or Stop can't interleave them.
 * The capturer belongs to the caller, who closes it.
 */
export class SyncSession {
  private readonly lights: readonly WizLight[];
  private readonly events: SyncSessionEvents;
  private readonly restoreOnExit: boolean;
  private readonly clock: Clock;
  private capturer: ScreenCapturer;
  private sync: Partial<SyncOptions>;
  private engine: SyncEngine | undefined;
  private saved: Array<{ light: WizLight; params: SetPilotParams }> = [];
  private current: SessionState = "idle";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SyncSessionOptions, events: SyncSessionEvents = {}) {
    this.capturer = options.capturer;
    this.lights = options.lights;
    this.sync = { ...options.sync };
    this.restoreOnExit = options.restoreOnExit ?? true;
    this.clock = options.clock ?? systemClock;
    this.events = events;
  }

  get state(): SessionState {
    return this.current;
  }

  /** The options of the running engine, or the ones the next start will use. */
  get syncOptions(): Readonly<Partial<SyncOptions>> {
    return this.engine?.options ?? this.sync;
  }

  /** Starts syncing. Does nothing while already running. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.current !== "idle") return;
      this.setState("starting");
      this.saved = [];
      try {
        if (this.restoreOnExit) {
          const states = await Promise.allSettled(this.lights.map((light) => light.getPilot()));
          states.forEach((result, i) => {
            const light = this.lights[i]!;
            if (result.status === "fulfilled") this.saved.push({ light, params: pilotToRestoreParams(result.value) });
            else this.events.onRestoreUnavailable?.(light.host, result.reason);
          });
        }
        this.engine = this.createEngine();
        this.engine.start();
      } catch (error) {
        this.engine = undefined;
        this.setState("idle");
        throw error;
      }
      this.setState("running");
    });
  }

  /**
   * Changes options, and the capturer (e.g. another display). While running the engine restarts with them at once,
   * keeping the saved bulb states; smoothing starts over.
   */
  update(changes: { sync?: Partial<SyncOptions>; capturer?: ScreenCapturer }): Promise<void> {
    return this.enqueue(async () => {
      if (changes.sync) this.sync = { ...this.sync, ...changes.sync };
      if (changes.capturer) this.capturer = changes.capturer;
      if (this.current !== "running" || !this.engine) return;
      await this.engine.stop();
      this.engine = this.createEngine();
      this.engine.start();
    });
  }

  /** Stops syncing and sends each bulb its saved state. Does nothing while idle. */
  stop(): Promise<StopResult> {
    return this.enqueue(async () => {
      if (this.current !== "running") return { restored: [] };
      this.setState("stopping");
      await this.engine?.stop();
      this.engine = undefined;
      const restored: string[] = [];
      const results = await Promise.allSettled(this.saved.map(({ light, params }) => light.setPilot(params)));
      results.forEach((result, i) => {
        if (result.status === "fulfilled") restored.push(this.saved[i]!.light.host);
        else this.events.onError?.(result.reason);
      });
      this.saved = [];
      this.setState("idle");
      return { restored };
    });
  }

  private createEngine(): SyncEngine {
    return new SyncEngine(
      this.capturer,
      this.lights,
      this.sync,
      { onFrame: (report) => this.events.onFrame?.(report), onError: (error) => this.events.onError?.(error) },
      this.clock,
    );
  }

  private setState(state: SessionState): void {
    this.current = state;
    this.events.onState?.(state);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
