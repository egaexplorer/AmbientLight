import { clamp01, linearToSrgb, rgbToHsv, srgbToLinear } from "./convert.js";
import type { PixelFrame, Rgb } from "./types.js";

/** Lookup table: sRGB byte → linear light, so averaging stays cheap. */
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i));

/** At `colorWeighting` 1, the most vivid pixel counts this many times as much as a gray one. */
const MAX_VIVID_WEIGHT = 10;

/** Hue histogram size for `colorMode: "dominant"`: 36 bins of 10°. */
const HUE_BINS = 36;
/**
 * A hue family is the peak bin ± this many bins (50° in all). Close hues such as red and orange still blend;
 * distant ones such as red and green never do.
 */
const HUE_WINDOW = 2;
/**
 * Pixels with less chroma than this (max − min channel, 0–1, which equals saturation × brightness) count as
 * neutral: gray, white, black, or too dark to have a reliable hue.
 */
const MIN_CHROMA = 0.12;
/**
 * The previous frame's hue family keeps winning unless another one is this much stronger, so a scene with two
 * similar-sized colors doesn't make the light jump between them.
 */
export const HUE_STICKINESS = 1.3;

/**
 * How the hue is picked:
 * - `"dominant"`: colorful pixels are grouped by hue and only the strongest hue family (plus the neutral
 *   pixels) is averaged. A red and green scene gives red or green, never the olive in between.
 * - `"average"`: all pixels are averaged, so different hues mix.
 */
export type ColorMode = "dominant" | "average";

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
  /** Defaults to `"dominant"`. */
  colorMode?: ColorMode;
  /** Hue (degrees) chosen for the previous frame. Its hue family wins near-ties (see `HUE_STICKINESS`). */
  preferHue?: number | undefined;
}

export interface FrameColors {
  /** Plain average in linear light: how much light the screen emits. Use it for brightness. */
  average: Rgb;
  /**
   * Color to take the hue from: the vivid-weighted average of the dominant hue family and the neutral pixels
   * (`"dominant"`), or of every pixel (`"average"`). Equals `average` with `"average"` and `colorWeighting` 0.
   */
  color: Rgb;
  /** Hue (degrees) of the dominant hue family; undefined when nothing on screen is colorful or in `"average"` mode. */
  hue?: number;
}

/**
 * Average color of a frame, computed in linear light (physically correct mixing)
 * and returned as sRGB 0–255 floats.
 *
 * A half-black / half-white frame therefore averages to ≈188, not 128 —
 * matching how much light the screen actually emits.
 */
export function averageColor(frame: PixelFrame, options: AverageOptions = {}): Rgb {
  return analyzeFrame(frame, { ...options, colorWeighting: 0, colorMode: "average" }).average;
}

/** Hue bin of a pixel whose channels are not all equal (`max > min`). */
function hueBin(r: number, g: number, b: number, max: number, min: number): number {
  const delta = max - min;
  let sextant: number;
  if (max === r) sextant = (g - b) / delta;
  else if (max === g) sextant = (b - r) / delta + 2;
  else sextant = (r - g) / delta + 4;
  if (sextant < 0) sextant += 6;
  return Math.floor((sextant * HUE_BINS) / 6) % HUE_BINS;
}

function binDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % HUE_BINS;
  return Math.min(d, HUE_BINS - d);
}

/**
 * Plain and color-weighted averages of a frame in one pass.
 *
 * A pixel's weight for `color` grows with its vividness, (saturation × brightness)² with both 0–1:
 * `1 + colorWeighting × 9 × vividness`. Bright, saturated pixels count up to 10 times as much as gray ones;
 * dark pixels barely more.
 *
 * In `"dominant"` mode, each colorful pixel also votes for its 10° hue bin with its vividness (so area and
 * vividness both count). The 50° window with the most votes is the dominant hue family; pixels of other hues
 * are left out of `color`. Neutral pixels stay in, so a small colorful area on a white page still reads as
 * nearly white.
 */
export function analyzeFrame(frame: PixelFrame, options: AnalyzeOptions = {}): FrameColors {
  const { data, width, height, channels } = frame;
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const total = width * height * channels;
  const vividGain = clamp01(options.colorWeighting ?? 0) * (MAX_VIVID_WEIGHT - 1);
  const dominant = (options.colorMode ?? "dominant") === "dominant";

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
  const minChroma = MIN_CHROMA * 255;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  // Weighted sums over every pixel ("average" mode) and over neutral pixels only ("dominant" mode).
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let w = 0;
  let nr = 0;
  let ng = 0;
  let nb = 0;
  let nw = 0;
  // Per hue bin: weighted linear sums, total weight, and votes.
  const binR = new Float64Array(HUE_BINS);
  const binG = new Float64Array(HUE_BINS);
  const binB = new Float64Array(HUE_BINS);
  const binW = new Float64Array(HUE_BINS);
  const votes = new Float64Array(HUE_BINS);
  let anyVotes = false;

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

    const max = Math.max(sr, sg, sb);
    const min = Math.min(sr, sg, sb);
    const vividness = (max - min) / 255;
    const weight = 1 + vividGain * vividness * vividness;
    wr += lr * weight;
    wg += lg * weight;
    wb += lb * weight;
    w += weight;

    if (!dominant) continue;
    if (max - min < minChroma) {
      nr += lr * weight;
      ng += lg * weight;
      nb += lb * weight;
      nw += weight;
    } else {
      const bin = hueBin(sr, sg, sb, max, min);
      binR[bin] = binR[bin]! + lr * weight;
      binG[bin] = binG[bin]! + lg * weight;
      binB[bin] = binB[bin]! + lb * weight;
      binW[bin] = binW[bin]! + weight;
      votes[bin] = votes[bin]! + vividness;
      anyVotes = true;
    }
  }

  if (n === 0) return { average: { r: 0, g: 0, b: 0 }, color: { r: 0, g: 0, b: 0 } };
  const average = { r: linearToSrgb(r / n), g: linearToSrgb(g / n), b: linearToSrgb(b / n) };
  if (!dominant || !anyVotes) {
    return { average, color: { r: linearToSrgb(wr / w), g: linearToSrgb(wg / w), b: linearToSrgb(wb / w) } };
  }

  const peak = dominantBin(votes, options.preferHue);
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let cw = 0;
  for (let k = -HUE_WINDOW; k <= HUE_WINDOW; k++) {
    const bin = (peak + k + HUE_BINS) % HUE_BINS;
    cr += binR[bin]!;
    cg += binG[bin]!;
    cb += binB[bin]!;
    cw += binW[bin]!;
  }
  const hue = rgbToHsv({ r: linearToSrgb(cr / cw), g: linearToSrgb(cg / cw), b: linearToSrgb(cb / cw) }).h;
  const sum = cw + nw;
  const color = {
    r: linearToSrgb((cr + nr) / sum),
    g: linearToSrgb((cg + ng) / sum),
    b: linearToSrgb((cb + nb) / sum),
  };
  return { average, color, hue };
}

/**
 * How much the picture changed between two frames: the mean absolute difference of the color channels, 0–255,
 * over every `step`-th pixel. A hard cut in a video gives a large value, motion within a scene a small one.
 * Frames of different sizes or channel counts (e.g. from another capturer) can't be compared and give 0.
 */
export function frameChange(a: PixelFrame, b: PixelFrame, step = 1): number {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return 0;
  const [ar, ag, ab] = a.order === "bgr" ? [2, 1, 0] : [0, 1, 2];
  const [br, bg, bb] = b.order === "bgr" ? [2, 1, 0] : [0, 1, 2];
  const stride = a.channels * Math.max(1, Math.floor(step));
  const total = Math.min(a.width * a.height * a.channels, a.data.length, b.data.length);
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < total; i += stride) {
    sum +=
      Math.abs(a.data[i + ar]! - b.data[i + br]!) +
      Math.abs(a.data[i + ag]! - b.data[i + bg]!) +
      Math.abs(a.data[i + ab]! - b.data[i + bb]!);
    n += 3;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Center bin of the hue family: the window with the most votes (the one around `preferHue` gets a bonus),
 * then moved onto the vote-weighted middle of that window. Several windows can tie, and the first one found
 * may sit to one side of the colors it holds; the shift centers it.
 */
function dominantBin(votes: Float64Array, preferHue: number | undefined): number {
  const preferred =
    preferHue !== undefined && Number.isFinite(preferHue)
      ? Math.floor((((preferHue % 360) + 360) % 360) / (360 / HUE_BINS)) % HUE_BINS
      : -1;
  let best = 0;
  let bestScore = -1;
  for (let center = 0; center < HUE_BINS; center++) {
    let score = 0;
    for (let k = -HUE_WINDOW; k <= HUE_WINDOW; k++) score += votes[(center + k + HUE_BINS) % HUE_BINS]!;
    if (preferred >= 0 && binDistance(center, preferred) <= 1) score *= HUE_STICKINESS;
    if (score > bestScore) {
      best = center;
      bestScore = score;
    }
  }

  let offset = 0;
  let mass = 0;
  for (let k = -HUE_WINDOW; k <= HUE_WINDOW; k++) {
    const v = votes[(best + k + HUE_BINS) % HUE_BINS]!;
    offset += k * v;
    mass += v;
  }
  return mass > 0 ? (best + Math.round(offset / mass) + HUE_BINS) % HUE_BINS : best;
}
