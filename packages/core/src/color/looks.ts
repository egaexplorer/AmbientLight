import { type CalibrationOptions, mutedGreenAmount } from "./calibration.js";
import { clamp, hsvToRgb, rgbToHsv } from "./convert.js";
import type { Rgb } from "./types.js";

/** How one genre bends the screen's light. The numbers are relative to the user's own calibration where they can be. */
export interface FilmLook {
  /** Hue (degrees) that colors lean toward, by at most `MAX_HUE_TURN`. */
  hue: number;
  /** Multiplies `saturationBoost`. */
  saturation: number;
  /** Multiplies `gamma`. */
  gamma: number;
  /** Upper limit for `maxDimming`. */
  maxDimming: number;
  /** Lower limit for `colorBaseBrightness`, at full `maxDimming`. */
  colorBase: number;
  whiteTemp: number;
}

// Tuned on frames of three open films, not yet by eye on the bulb (docs/ROADMAP.md, "Film looks").
export const FILM_LOOKS = {
  horror: { hue: 220, saturation: 0.77, gamma: 0.75, maxDimming: 45, colorBase: 10, whiteTemp: 6500 },
  // Deep and dim, where drama is soft: with the same softness the two differed on only 22 % of real frames.
  thriller: { hue: 190, saturation: 1.25, gamma: 1.2, maxDimming: 55, colorBase: 10, whiteTemp: 5700 },
  romance: { hue: 340, saturation: 1.15, gamma: 0.875, maxDimming: 75, colorBase: 10, whiteTemp: 2700 },
  animation: { hue: 30, saturation: 1.46, gamma: 1.19, maxDimming: 100, colorBase: 45, whiteTemp: 4500 },
  comedy: { hue: 35, saturation: 1.15, gamma: 1, maxDimming: 100, colorBase: 30, whiteTemp: 3500 },
  // Not bluer: from 250 the short way for warm scenes runs through red, and scifi looked like romance.
  scifi: { hue: 200, saturation: 1.2, gamma: 1.1, maxDimming: 85, colorBase: 15, whiteTemp: 6500 },
  action: { hue: 15, saturation: 1.3, gamma: 1.15, maxDimming: 100, colorBase: 20, whiteTemp: 5500 },
  drama: { hue: 30, saturation: 0.85, gamma: 0.9, maxDimming: 80, colorBase: 10, whiteTemp: 3800 },
} as const satisfies Record<string, FilmLook>;

export type LookName = keyof typeof FILM_LOOKS;
export const LOOK_NAMES = Object.keys(FILM_LOOKS) as LookName[];

/**
 * More than this and scenes lose their own color: blending in 25 % of a genre color turned skies white and moved
 * hues by up to 179°.
 */
export const MAX_HUE_TURN = 20;

// The first match wins, so the order is the priority: a comedy horror is a comedy, an animated musical is animation.
const GENRE_RULES: ReadonlyArray<readonly [RegExp, LookName]> = [
  [/horror.*comedy|comedy.*horror/i, "comedy"],
  [/\b(horror|slasher|zombie)\b/i, "horror"],
  [/\b(animated|animation|anime|cartoon)\b/i, "animation"],
  [/\b(romance|romantic)\b/i, "romance"],
  [/\b(comedy|musical|family|children)\b/i, "comedy"],
  [/\b(science[ -]fiction|space opera|cyberpunk|dystopian)\b/i, "scifi"],
  [/\b(action|superhero|adventure|fantasy|war|martial arts|western|sports?)\b/i, "action"],
  [/\b(thriller|crime|mystery|noir|suspense|espionage)\b/i, "thriller"],
  [/\b(drama|biographical|documentary|historical|coming[ -]of[ -]age)\b/i, "drama"],
];

/** Picks a look from genre words such as "2024 Indonesian comedy horror". `undefined` when none is known. */
export function lookForGenres(text: string): LookName | undefined {
  return GENRE_RULES.find(([pattern]) => pattern.test(text))?.[1];
}

/** The user's calibration with a look on top. */
export function applyLook(calibration: CalibrationOptions, look: FilmLook): CalibrationOptions {
  const { minDimming } = calibration;
  const maxDimming = Math.max(minDimming, Math.min(calibration.maxDimming, look.maxDimming));
  const wantedBase = Math.max(minDimming, calibration.colorBaseBrightness, look.colorBase);
  // The base shrinks with the cap. Otherwise a dark cap flattens every scene to the same brightness.
  const range = calibration.maxDimming - minDimming;
  const scale = range > 0 ? (maxDimming - minDimming) / range : 0;
  return {
    ...calibration,
    saturationBoost: clamp(calibration.saturationBoost * look.saturation, 0, 5),
    gamma: clamp(calibration.gamma * look.gamma, 0, 5),
    maxDimming,
    colorBaseBrightness: Math.round(clamp(minDimming + (wantedBase - minDimming) * scale, minDimming, maxDimming)),
    whiteTemp: look.whiteTemp,
  };
}

/**
 * Leans a color's hue toward `target` by at most `MAX_HUE_TURN`, keeping saturation and value.
 * The turn is largest 60° from the target and gone from 120°, so distant colors stay themselves (teal doesn't turn
 * green in a warm look). It also fades out on muted greens, which would look yellow again (`mutedGreenCorrection`).
 * @param brightness The screen's plain average, which decides what counts as a muted green.
 */
export function turnHue(color: Rgb, target: number, brightness: Rgb = color): Rgb {
  const { h, s, v } = rgbToHsv(color);
  if (s === 0) return color;
  const difference = ((((target - h) % 360) + 540) % 360) - 180;
  const distance = Math.abs(difference);
  const amount =
    (distance < 120 ? MAX_HUE_TURN * Math.sin((distance * 1.5 * Math.PI) / 180) : 0) *
    (1 - mutedGreenAmount(h, s, rgbToHsv(brightness).v));
  return hsvToRgb({ h: h + Math.sign(difference) * amount, s, v });
}
