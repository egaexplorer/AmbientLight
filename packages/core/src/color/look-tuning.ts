import { WIZ_MAX_DIMMING, WIZ_MAX_TEMP, WIZ_MIN_DIMMING, WIZ_MIN_TEMP } from "../wiz/constants.js";
import { clamp } from "./convert.js";
import type { FilmLook } from "./looks.js";

/** One nudge away from a look, in steps: 0 keeps it, ±2 is the most an AI may move it. */
export type TuningStep = -2 | -1 | 0 | 1 | 2;

/** How a title's look differs from its genre look. The hue lean always stays the genre's. */
export interface LookTuning {
  brightness: TuningStep;
  warmth: TuningStep;
  vividness: TuningStep;
}

export type TuningControl = keyof LookTuning;
export const TUNING_CONTROLS: readonly TuningControl[] = ["brightness", "warmth", "vividness"];

/** The words for steps −2 to +2, in order. An AI picks words (more reliable than numbers); `stepOf` reads them. */
export const TUNING_WORDS: Readonly<Record<TuningControl, readonly [string, string, string, string, string]>> = {
  brightness: ["much dimmer", "dimmer", "same", "brighter", "much brighter"],
  warmth: ["much cooler", "cooler", "same", "warmer", "much warmer"],
  vividness: ["much softer", "softer", "same", "more vivid", "much more vivid"],
};

/**
 * What one step changes. Steps are large enough to see on a WiZ bulb, where a few % of dimming is invisible.
 * The color base moves too, so "brighter" still does something on looks that already reach 100 %.
 */
export const TUNING_STEP_SIZES = {
  /** `maxDimming` points per step. */
  maxDimming: 10,
  /** `colorBase` points per step. */
  colorBase: 5,
  /** Kelvin per step; warmer is lower. Only white and gray scenes use `whiteTemp`. */
  whiteTemp: 800,
  /** Share of the look's `saturation` per step. */
  saturation: 0.15,
} as const;

/** The step a word stands for, or `undefined` for any other text. */
export function stepOf(control: TuningControl, word: unknown): TuningStep | undefined {
  const index = TUNING_WORDS[control].indexOf(word as string);
  return index < 0 ? undefined : ((index - 2) as TuningStep);
}

/** A look nudged by a tuning, within the bulb's ranges. Other fields (a game look's `pace`) are kept. */
export function tuneLook<T extends FilmLook>(look: T, tuning: LookTuning): T {
  const size = TUNING_STEP_SIZES;
  const maxDimming = clamp(look.maxDimming + size.maxDimming * tuning.brightness, WIZ_MIN_DIMMING, WIZ_MAX_DIMMING);
  return {
    ...look,
    maxDimming,
    colorBase: clamp(look.colorBase + size.colorBase * tuning.brightness, WIZ_MIN_DIMMING, maxDimming),
    whiteTemp: clamp(look.whiteTemp - size.whiteTemp * tuning.warmth, WIZ_MIN_TEMP, WIZ_MAX_TEMP),
    saturation: Math.round(look.saturation * (1 + size.saturation * tuning.vividness) * 1000) / 1000,
  };
}

/** The changes in words, e.g. `["brighter", "much warmer"]`; empty when the tuning keeps the look. */
export function tuningWords(tuning: LookTuning): string[] {
  return TUNING_CONTROLS.filter((control) => tuning[control] !== 0).map((control) => TUNING_WORDS[control][tuning[control] + 2]!);
}
