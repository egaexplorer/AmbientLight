import { linearToSrgb, srgbToLinear } from "./convert.js";
import type { PixelFrame, Rgb } from "./types.js";

/** Lookup table: sRGB byte → linear light, so averaging stays cheap. */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

export interface AverageOptions {
  /** Sample every Nth pixel (1 = every pixel). Useful when the frame was not downscaled. */
  step?: number;
}

/**
 * Average color of a frame, computed in linear light (physically correct mixing)
 * and returned as sRGB 0–255 floats.
 *
 * A half-black / half-white frame therefore averages to ≈188, not 128 —
 * matching how much light the screen actually emits.
 */
export function averageColor(frame: PixelFrame, options: AverageOptions = {}): Rgb {
  const { data, width, height, channels } = frame;
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const total = width * height * channels;

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

  for (let i = 0; i < total; i += stride) {
    r += SRGB_TO_LINEAR[data[i + ri]!]!;
    g += SRGB_TO_LINEAR[data[i + gi]!]!;
    b += SRGB_TO_LINEAR[data[i + bi]!]!;
    n++;
  }

  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: linearToSrgb(r / n), g: linearToSrgb(g / n), b: linearToSrgb(b / n) };
}
