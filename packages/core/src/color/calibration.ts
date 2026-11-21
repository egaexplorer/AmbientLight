import { WIZ_MAX_DIMMING, WIZ_MAX_TEMP, WIZ_MIN_DIMMING, WIZ_MIN_TEMP } from "../wiz/constants.js";
import { clamp, clamp01, hsvToRgb, rgbToHsv } from "./convert.js";
import type { Rgb, WizColor } from "./types.js";

export interface CalibrationOptions {
  /** Multiplies HSV saturation. Screen averages are washed out, so >1 makes the light more vivid. */
  saturationBoost: number;
  /** Gamma applied to the normalized color channels. >1 deepens colors (weaker channels drop faster). */
  gamma: number;
  /** Dimming (%) used for the darkest scenes. WiZ accepts 10–100. */
  minDimming: number;
  /** Dimming (%) used for the brightest scenes. */
  maxDimming: number;
  /** Curve applied to screen brightness before mapping to dimming. <1 lifts dark scenes, >1 deepens them. */
  brightnessGamma: number;
  /** Screen brightness (0–1) below which the bulb is held at minDimming. */
  blackThreshold: number;
  /**
   * Below this saturation (after `saturationBoost`), the bulb uses its white LEDs (`whiteTemp`) instead of
   * mixing white from RGB, which looks lavender on WiZ bulbs. 0 turns white mode off.
   */
  whiteSaturation: number;
  /** Color temperature in Kelvin for white mode (WiZ color bulbs accept about 2200–6500). */
  whiteTemp: number;
}

export const DEFAULT_CALIBRATION: Readonly<CalibrationOptions> = Object.freeze({
  saturationBoost: 1.3,
  gamma: 1.6,
  minDimming: WIZ_MIN_DIMMING,
  maxDimming: WIZ_MAX_DIMMING,
  brightnessGamma: 1,
  blackThreshold: 0.04,
  whiteSaturation: 0.15,
  whiteTemp: 5000,
});

/**
 * A color leaves white mode only once its saturation is this much above `whiteSaturation`, so a scene
 * near the threshold doesn't flip the bulb between white and color LEDs every frame.
 */
export const WHITE_HYSTERESIS = 0.05;

export interface CalibrationContext {
  /**
   * Screen color that drives `dimming`. Defaults to the input. Pass the plain frame average when the
   * input is a color-weighted average, so vivid details set the hue but not the brightness.
   */
  brightness?: Rgb;
  /** Whether the previous frame was shown in white mode (enables the hysteresis). */
  wasWhite?: boolean;
}

/**
 * Turns an averaged screen color into a WiZ color.
 *
 * WiZ bulbs treat r/g/b as the *hue mix* and `dimming` as brightness, so the color is
 * normalized to full value (brightest channel = 255) and the screen brightness drives
 * `dimming` instead. Saturation boost and gamma compensate for averaging washing colors out.
 * Nearly gray colors are shown with the bulb's white LEDs (`temp`) instead of RGB.
 */
export function calibrate(input: Rgb, options: Partial<CalibrationOptions> = {}, context: CalibrationContext = {}): WizColor {
  const o: CalibrationOptions = { ...DEFAULT_CALIBRATION, ...options };
  const minDimming = clamp(o.minDimming, WIZ_MIN_DIMMING, WIZ_MAX_DIMMING);
  const maxDimming = clamp(o.maxDimming, minDimming, WIZ_MAX_DIMMING);

  const hsv = rgbToHsv(input);
  const saturation = clamp01(hsv.s * Math.max(0, o.saturationBoost));

  const value = context.brightness ? rgbToHsv(context.brightness).v : hsv.v;
  const threshold = clamp(o.blackThreshold, 0, 0.99);
  let dimming = minDimming;
  if (value > threshold) {
    const t = (value - threshold) / (1 - threshold);
    dimming = minDimming + (maxDimming - minDimming) * t ** Math.max(0.01, o.brightnessGamma);
  }
  dimming = Math.round(clamp(dimming, minDimming, maxDimming));

  const whiteBelow = o.whiteSaturation + (context.wasWhite ? WHITE_HYSTERESIS : 0);
  if (o.whiteSaturation > 0 && saturation < whiteBelow) {
    return { r: 255, g: 255, b: 255, dimming, temp: Math.round(clamp(o.whiteTemp, WIZ_MIN_TEMP, WIZ_MAX_TEMP)) };
  }

  let { r, g, b } = hsvToRgb({ h: hsv.h, s: saturation, v: 1 });
  if (o.gamma > 0 && o.gamma !== 1) {
    r = 255 * (r / 255) ** o.gamma;
    g = 255 * (g / 255) ** o.gamma;
    b = 255 * (b / 255) ** o.gamma;
  }

  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
    dimming,
  };
}
