import { clamp, type FrameReport, previewRgb, type Rgb, type WizColor } from "@ambientlight/core";
import type { FrameView } from "../shared/api";

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Approximate color of white light at `kelvin` (a common curve fit of blackbody colors, 1000–40000 K), for drawing
 * the white LEDs on screen. Display only: the bulb's own white decides what the room looks like.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
}

/** What the bulb shows, for the screen: the white LEDs at their temperature, or the color it mixes. */
export function bulbPreview(output: WizColor, paleWhite: number): { color: string; text: string } {
  if (output.temp !== undefined) {
    return { color: toHex(kelvinToRgb(output.temp)), text: `white ${output.temp} K · dim ${output.dimming} %` };
  }
  return { color: toHex(previewRgb(output, paleWhite)), text: `dim ${output.dimming} %` };
}

/**
 * Turns `FrameReport`s into `FrameView`s for the renderer: counts frames per second and the share sent, and lets
 * through at most one view per `intervalMs`, so the renderer isn't flooded at 20 FPS.
 */
export class FrameViews {
  private frames = 0;
  private sent = 0;
  private windowFrames = 0;
  private windowStart: number;
  private fps = 0;
  private lastEmit = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly paleWhite: number;
  private readonly intervalMs: number;

  constructor(now: () => number, paleWhite: number, intervalMs = 100) {
    this.now = now;
    this.paleWhite = paleWhite;
    this.intervalMs = intervalMs;
    this.windowStart = now();
  }

  /** Returns the view to show, or undefined when the previous one is recent enough. */
  next(report: FrameReport): FrameView | undefined {
    const now = this.now();
    this.frames++;
    if (report.sent) this.sent++;
    // Frames per second over the last full second; this frame opens the next window.
    if (now - this.windowStart >= 1000) {
      this.fps = (this.windowFrames * 1000) / (now - this.windowStart);
      this.windowFrames = 0;
      this.windowStart = now;
    }
    this.windowFrames++;
    if (now - this.lastEmit < this.intervalMs) return undefined;
    this.lastEmit = now;

    const bulb = bulbPreview(report.output, this.paleWhite);
    return {
      screen: toHex(report.average),
      hue: toHex(report.color),
      bulb: bulb.color,
      bulbText: bulb.text,
      fps: Math.round(this.fps * 10) / 10,
      captureMs: Math.round(report.captureMs),
      sentShare: this.sent / this.frames,
      cut: report.cut,
    };
  }
}
