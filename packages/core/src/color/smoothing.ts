import { clamp01 } from "./convert.js";
import type { Rgb, WizColor } from "./types.js";

/**
 * Exponential moving average over colors, to stop the bulb flickering on fast cuts and noise.
 *
 * `alpha` is the weight of the newest sample: 1 = no smoothing, 0.3 = slow and calm.
 * The effective time constant depends on the frame rate (≈ 1 / (alpha × fps) seconds).
 */
export class EmaSmoother {
  private state: Rgb | undefined;
  private readonly alpha: number;

  constructor(alpha: number) {
    this.alpha = clamp01(alpha);
  }

  next(sample: Rgb): Rgb {
    if (this.state === undefined || this.alpha >= 1) {
      this.state = { r: sample.r, g: sample.g, b: sample.b };
    } else {
      const a = this.alpha;
      this.state = {
        r: this.state.r + a * (sample.r - this.state.r),
        g: this.state.g + a * (sample.g - this.state.g),
        b: this.state.b + a * (sample.b - this.state.b),
      };
    }
    return { ...this.state };
  }

  reset(): void {
    this.state = undefined;
  }
}

/**
 * Largest visible difference between two WiZ colors, in 0–255 channel units.
 * Dimming (0–100 %) is scaled by 2.55 so both are comparable against one threshold.
 * Switching between white mode (`temp`) and RGB, or to another temperature, always counts as a change.
 */
export function colorDistance(a: WizColor, b: WizColor): number {
  if (a.temp !== b.temp) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.dimming - b.dimming) * 2.55,
  );
}
