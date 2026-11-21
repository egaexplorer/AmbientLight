import { analyzeFrame, type ColorMode, frameChange } from "../color/average.js";
import { type CalibrationOptions, calibrate } from "../color/calibration.js";
import { clamp } from "../color/convert.js";
import { colorDistance, EmaSmoother } from "../color/smoothing.js";
import type { PixelFrame, Rgb, WizColor } from "../color/types.js";
import { type Clock, clearTimer, setTimer, systemClock, type TimerHandle } from "../platform/timers.js";
import type { ColorSink, ScreenCapturer } from "./types.js";

/**
 * Highest rate measured to work on a WiZ bulb (ESP25_SHRGB_01, firmware 1.38.0, 2026-11-21: smooth at 20 FPS).
 * Above it the CLI warns; faster rates are untested.
 */
export const RECOMMENDED_MAX_FPS = 20;
export const MIN_FPS = 1;
export const MAX_FPS = 30;

/**
 * A dominant-hue jump bigger than this (degrees) is a scene cut, shown at once instead of faded. Up to 60° an
 * RGB fade stays vivid (red → yellow passes orange); beyond it, it passes a muddy color (red → green: olive).
 */
const SCENE_CUT_HUE = 60;

export interface SyncOptions {
  /** Target updates per second (up to 20 measured to work on a WiZ bulb). */
  fps: number;
  /**
   * 0–1: share of the way to a new color covered in 100 ms, the same at any FPS. 1 = no smoothing.
   * Scene cuts (see `sceneCut`) and dominant-hue jumps of more than 60° (e.g. red → green) are shown at once instead.
   */
  smoothing: number;
  /** Skip sending when the color moved less than this (0–255 units; dimming scaled by 2.55). */
  minChange: number;
  /**
   * A frame whose pixels changed by at least this much on average (0–255, see `frameChange`) is a scene cut: its
   * color and brightness are shown at once instead of faded. 0 turns this off.
   */
  sceneCut: number;
  /** Re-send the current color at least this often, in case a UDP packet was lost. */
  keepAliveMs: number;
  /** Average every Nth pixel of the captured frame. */
  sampleStep: number;
  /** 0–1: how much more vivid pixels count when picking the hue (brightness always uses the plain average). */
  colorWeighting: number;
  /** `"dominant"`: hue from the strongest hue family on screen; `"average"`: hue from all pixels mixed. */
  colorMode: ColorMode;
  calibration: Partial<CalibrationOptions>;
}

export const DEFAULT_SYNC_OPTIONS: Readonly<SyncOptions> = Object.freeze({
  fps: 20,
  smoothing: 0.7,
  minChange: 4,
  sceneCut: 40,
  keepAliveMs: 2000,
  sampleStep: 1,
  colorWeighting: 0.6,
  colorMode: "dominant",
  calibration: {},
});

export interface FrameReport {
  /** Raw average screen color (drives brightness). */
  average: Rgb;
  /** Color the hue is taken from (see `colorMode`). */
  color: Rgb;
  /** Color after smoothing and calibration. */
  output: WizColor;
  /** Whether the color was sent to the bulbs this frame. */
  sent: boolean;
  /** Whether this frame was a scene cut (or a dominant-hue jump) and skipped smoothing. */
  cut: boolean;
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
  private readonly colorSmoother: EmaSmoother;
  private readonly brightnessSmoother: EmaSmoother;
  private white = false;
  /** Dominant hue of the previous frame, so near-ties keep the same color. */
  private hue: number | undefined;
  /** Copy of the previous frame, to detect scene cuts. */
  private previous: PixelFrame | undefined;

  private isRunning = false;
  private loopPromise: Promise<void> | undefined;
  private sleepTimer: TimerHandle | undefined;
  private wake: (() => void) | undefined;
  private lastSent: WizColor | undefined;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private lastFrameAt = Number.NEGATIVE_INFINITY;

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
    this.colorSmoother = new EmaSmoother(this.options.smoothing);
    this.brightnessSmoother = new EmaSmoother(this.options.smoothing);
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

    const { average, color, hue } = analyzeFrame(frame, {
      step: this.options.sampleStep,
      colorWeighting: this.options.colorWeighting,
      colorMode: this.options.colorMode,
      preferHue: this.hue,
    });
    const cut = this.isCut(frame, hue);
    if (cut) {
      this.colorSmoother.reset();
      this.brightnessSmoother.reset();
    }
    this.hue = hue;
    // Copied, because a capturer may reuse its buffer for the next frame.
    this.previous = { ...frame, data: new Uint8Array(frame.data) };
    const dt = startedAt - this.lastFrameAt;
    this.lastFrameAt = startedAt;
    const output = calibrate(this.colorSmoother.next(color, dt), this.options.calibration, {
      brightness: this.brightnessSmoother.next(average, dt),
      wasWhite: this.white,
    });
    this.white = output.temp !== undefined;

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

    return { average, color, output, sent, cut, captureMs, totalMs: this.clock.now() - startedAt };
  }

  /** A scene cut (the picture changed by `sceneCut` or more) or a dominant-hue jump of more than 60°. */
  private isCut(frame: PixelFrame, hue: number | undefined): boolean {
    const { sceneCut, sampleStep } = this.options;
    if (sceneCut > 0 && this.previous !== undefined && frameChange(this.previous, frame, sampleStep) >= sceneCut) {
      return true;
    }
    if (hue === undefined || this.hue === undefined) return false;
    const d = Math.abs(hue - this.hue) % 360;
    return Math.min(d, 360 - d) > SCENE_CUT_HUE;
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
    this.colorSmoother.reset();
    this.brightnessSmoother.reset();
    this.white = false;
    this.hue = undefined;
    this.previous = undefined;
    this.lastSent = undefined;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
  }

  private async run(): Promise<void> {
    let nextAt = this.clock.now();
    while (this.isRunning) {
      try {
        this.events.onFrame?.(await this.tick());
      } catch (error) {
        this.events.onError?.(error);
      }
      if (!this.isRunning) break;
      // Aim at fixed frame times, so a timer that fires late (Windows rounds timers up to ~16 ms) shortens the
      // next wait instead of lowering the frame rate. A frame that overran its slot starts the next one at once,
      // without a burst to catch up.
      nextAt = Math.max(nextAt + this.intervalMs, this.clock.now());
      await this.sleep(nextAt - this.clock.now());
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
