import { clamp01, linearToSrgb, srgbToLinear } from "./convert.js";
import type { PixelFrame, Rgb } from "./types.js";

/** Lookup table: sRGB byte → linear light, so averaging stays cheap. */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

/** At `colorWeighting` 1, the most vivid pixel counts this many times as much as a gray one. */
const MAX_VIVID_WEIGHT = 10;

export interface AverageOptions {
  /** Sample every Nth pixel (1 = every pixel). Useful when the frame was not downscaled. */
  step?: number;
}

export interface AnalyzeOptions extends AverageOptions {
  /**
   * 0–1. How much more bright, saturated pixels count toward `color`. 0 = plain average. Gray and dull
   * pixels always count once, so a small colorful icon on a white page still leaves the color near white,
   * while a video covering part of the screen sets the hue.
   */
  colorWeighting?: number;
}

export interface FrameColors {
  /** Plain average in linear light: how much light the screen emits. Use it for brightness. */
  average: Rgb;
  /** Average that weights vivid pixels more (equals `average` when `colorWeighting` is 0). Use it for hue. */
  color: Rgb;
}

/**
 * Average color of a frame, computed in linear light (physically correct mixing)
 * and returned as sRGB 0–255 floats.
 *
 * A half-black / half-white frame therefore averages to ≈188, not 128 —
 * matching how much light the screen actually emits.
 */
export function averageColor(frame: PixelFrame, options: AverageOptions = {}): Rgb {
  return analyzeFrame(frame, { ...options, colorWeighting: 0 }).average;
}

/**
 * Plain and color-weighted averages of a frame in one pass. A pixel's weight for `color` grows with its
 * vividness, (saturation × brightness)² with both 0–1: `1 + colorWeighting × 9 × vividness`. Bright,
 * saturated pixels count up to 10 times as much as gray ones; dark pixels barely more.
 */
export function analyzeFrame(frame: PixelFrame, options: AnalyzeOptions = {}): FrameColors {
  const { data, width, height, channels } = frame;
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const total = width * height * channels;
  const vividGain = clamp01(options.colorWeighting ?? 0) * (MAX_VIVID_WEIGHT - 1);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`Invalid frame size ${width}x${height}`);
  }
  if (data.length < total) {
    throw new RangeError(
      `Frame buffer too small: expected ${total} bytes for ${width}x${height}x${channels}, got ${data.length}`,
    );
  }

  const [ri, gi, bi] = frame.order === "bgr" ? [2, 1, 0] : [0, 1, 2];
  const stride = channels * step;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let w = 0;

  for (let i = 0; i < total; i += stride) {
    const sr = data[i + ri]!;
    const sg = data[i + gi]!;
    const sb = data[i + bi]!;
    const lr = SRGB_TO_LINEAR[sr]!;
    const lg = SRGB_TO_LINEAR[sg]!;
    const lb = SRGB_TO_LINEAR[sb]!;
    r += lr;
    g += lg;
    b += lb;
    n++;

    if (vividGain > 0) {
      const max = Math.max(sr, sg, sb);
      const saturation = max > 0 ? (max - Math.min(sr, sg, sb)) / max : 0;
      const vividness = saturation * (max / 255);
      const weight = 1 + vividGain * vividness * vividness;
      wr += lr * weight;
      wg += lg * weight;
      wb += lb * weight;
      w += weight;
    }
  }

  if (n === 0) return { average: { r: 0, g: 0, b: 0 }, color: { r: 0, g: 0, b: 0 } };
  const average = { r: linearToSrgb(r / n), g: linearToSrgb(g / n), b: linearToSrgb(b / n) };
  const color = w > 0 ? { r: linearToSrgb(wr / w), g: linearToSrgb(wg / w), b: linearToSrgb(wb / w) } : { ...average };
  return { average, color };
}
