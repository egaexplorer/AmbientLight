import { averageColor } from "../color/average.js";
import { type CalibrationOptions, calibrate } from "../color/calibration.js";
import { clamp } from "../color/convert.js";
import { colorDistance, EmaSmoother } from "../color/smoothing.js";
import type { Rgb, WizColor } from "../color/types.js";
import { type Clock, clearTimer, setTimer, systemClock, type TimerHandle } from "../platform/timers.js";
import type { ColorSink, ScreenCapturer } from "./types.js";

/** WiZ bulbs start to lag or drop updates above roughly this rate. */
export const RECOMMENDED_MAX_FPS = 15;
export const MIN_FPS = 1;
export const MAX_FPS = 30;

export interface SyncOptions {
  /** Target updates per second (5–15 recommended for WiZ). */
  fps: number;
  /** EMA weight of the newest frame, 0–1. 1 = no smoothing. */
  smoothing: number;
  /** Skip sending when the color moved less than this (0–255 units; dimming scaled by 2.55). */
  minChange: number;
  /** Re-send the current color at least this often, in case a UDP packet was lost. */
  keepAliveMs: number;
  /** Average every Nth pixel of the captured frame. */
  sampleStep: number;
  calibration: Partial<CalibrationOptions>;
}

export const DEFAULT_SYNC_OPTIONS: Readonly<SyncOptions> = Object.freeze({
  fps: 10,
  smoothing: 0.5,
  minChange: 4,
  keepAliveMs: 2000,
  sampleStep: 1,
  calibration: {},
});

export interface FrameReport {
  /** Raw average screen color. */
  average: Rgb;
  /** Color after smoothing and calibration. */
  output: WizColor;
  /** Whether the color was sent to the bulbs this frame. */
  sent: boolean;
  captureMs: number;
  totalMs: number;
}

export interface SyncEvents {
  onFrame?(report: FrameReport): void;
  onError?(error: unknown): void;
}

/**
 * The capture → process → transmit loop.
 *
 * Frames are processed strictly one at a time and only the newest frame is ever sent,
 * so a slow capture or a slow bulb can never build up a backlog of stale colors.
 */
export class SyncEngine {
  readonly options: SyncOptions;
  private readonly capturer: ScreenCapturer;
  private readonly sinks: readonly ColorSink[];
  private readonly events: SyncEvents;
  private readonly clock: Clock;
  private readonly smoother: EmaSmoother;

  private isRunning = false;
  private loopPromise: Promise<void> | undefined;
  private sleepTimer: TimerHandle | undefined;
  private wake: (() => void) | undefined;
  private lastSent: WizColor | undefined;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(
    capturer: ScreenCapturer,
    sinks: readonly ColorSink[],
    options: Partial<SyncOptions> = {},
    events: SyncEvents = {},
    clock: Clock = systemClock,
  ) {
    const merged = { ...DEFAULT_SYNC_OPTIONS, ...options };
    this.options = { ...merged, fps: clamp(merged.fps, MIN_FPS, MAX_FPS) };
    this.capturer = capturer;
    this.sinks = sinks;
    this.events = events;
    this.clock = clock;
    this.smoother = new EmaSmoother(this.options.smoothing);
  }

  get running(): boolean {
    return this.isRunning;
  }

  get intervalMs(): number {
    return 1000 / this.options.fps;
  }

  /** Runs a single capture → process → (maybe) send iteration. */
  async tick(): Promise<FrameReport> {
    const startedAt = this.clock.now();
    const frame = await this.capturer.capture();
    const captureMs = this.clock.now() - startedAt;

    const average = averageColor(frame, { step: this.options.sampleStep });
    const output = calibrate(this.smoother.next(average), this.options.calibration);

    const now = this.clock.now();
    const sent =
      this.lastSent === undefined ||
      colorDistance(output, this.lastSent) >= this.options.minChange ||
      now - this.lastSentAt >= this.options.keepAliveMs;

    if (sent) {
      await this.send(output);
      this.lastSent = output;
      this.lastSentAt = now;
    }

    return { average, output, sent, captureMs, totalMs: this.clock.now() - startedAt };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loopPromise = this.run();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.sleepTimer !== undefined) clearTimer(this.sleepTimer);
    this.sleepTimer = undefined;
    this.wake?.();
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  /** Forget smoothing history and the last sent color (e.g. after switching displays). */
  reset(): void {
    this.smoother.reset();
    this.lastSent = undefined;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
  }

  private async run(): Promise<void> {
    while (this.isRunning) {
      const startedAt = this.clock.now();
      try {
        this.events.onFrame?.(await this.tick());
      } catch (error) {
        this.events.onError?.(error);
      }
      if (!this.isRunning) break;
      await this.sleep(this.intervalMs - (this.clock.now() - startedAt));
    }
  }

  private async send(color: WizColor): Promise<void> {
    const results = await Promise.allSettled(this.sinks.map((sink) => sink.setColor(color)));
    for (const result of results) {
      if (result.status === "rejected") this.events.onError?.(result.reason);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.sleepTimer = undefined;
        this.wake = undefined;
        resolve();
      };
      this.wake = done;
      this.sleepTimer = setTimer(done, Math.max(0, ms));
    });
  }
}
