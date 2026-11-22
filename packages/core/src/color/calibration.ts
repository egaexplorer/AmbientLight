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
  /**
   * Dimming (%) that dark colored scenes start from, because colors look dim on WiZ bulbs. It fades out toward
   * white and toward black, which keep `minDimming`. No effect at or below `minDimming`.
   */
  colorBaseBrightness: number;
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
  /**
   * White LED level (0–255) for pale colors, encoded the way the WiZ app does it (it uses 140): the hue goes on
   * `r,g,b` and the paleness on the white LEDs (`c`/`w`, tinted by the hue). A pale color mixed from the RGB LEDs
   * alone looks pink on WiZ bulbs. 0 = mix pale colors from RGB only (no `c`/`w` sent).
   */
  paleWhite: number;
  /**
   * 0–1: how far muted yellow-green to green scenes of dark or medium brightness are shown as their own faint tint
   * on cool white, instead of the boosted color on warm white, which looks yellow. Never changes the dimming.
   * Needs the white LEDs (`paleWhite` above 0). 0 = off.
   */
  mutedGreenCorrection: number;
}

export const DEFAULT_CALIBRATION: Readonly<CalibrationOptions> = Object.freeze({
  saturationBoost: 1.3,
  gamma: 1.6,
  minDimming: WIZ_MIN_DIMMING,
  maxDimming: WIZ_MAX_DIMMING,
  colorBaseBrightness: WIZ_MIN_DIMMING,
  brightnessGamma: 1,
  blackThreshold: 0.04,
  whiteSaturation: 0.15,
  whiteTemp: 5000,
  paleWhite: 140,
  mutedGreenCorrection: 1,
});

/**
 * A color leaves white mode only once its saturation is this much above `whiteSaturation`, so a scene
 * near the threshold doesn't flip the bulb between white and color LEDs every frame.
 */
export const WHITE_HYSTERESIS = 0.05;

/**
 * Saturation range over which `colorBaseBrightness` fades in. It starts above the white-mode hysteresis, so the
 * brightness doesn't jump when the bulb switches between white and color.
 */
const COLOR_BASE_SATURATION_RAMP = 0.15;
/** Screen brightness range above `blackThreshold` over which it fades in, so black and near-black noise stay dark. */
const COLOR_BASE_BRIGHTNESS_RAMP = 0.04;

// Where `mutedGreenCorrection` applies. Each limit is a fade, so a moving camera or a brightening scene doesn't make
// the light jump (docs/ARCHITECTURE.md, design decision 7).
/** Hue fade-in (degrees): none at 50, full from 65. Leaves orange, skin, beige and gold alone. */
const MUTED_GREEN_HUE_IN = [50, 65] as const;
/** Hue fade-out (degrees): full up to 150, none from 170. Leaves teal and blue alone. */
const MUTED_GREEN_HUE_OUT = [150, 170] as const;
/** Saturation fade-out, before `saturationBoost`: full up to 0.35, none from 0.5. Leaves grass and vivid colors alone. */
const MUTED_GREEN_SATURATION_OUT = [0.35, 0.5] as const;
/** Screen brightness fade-out: full up to 0.5, none from 0.7. Leaves bright pages and daylight scenes alone. */
const MUTED_GREEN_BRIGHTNESS_OUT = [0.5, 0.7] as const;

/** 0–1: how much a screen color counts as a muted green scene. */
export function mutedGreenAmount(hue: number, saturation: number, brightness: number): number {
  const fadeIn = ([from, to]: readonly [number, number], x: number): number => clamp01((x - from) / (to - from));
  const fadeOut = ([from, to]: readonly [number, number], x: number): number => clamp01((to - x) / (to - from));
  return (
    Math.min(fadeIn(MUTED_GREEN_HUE_IN, hue), fadeOut(MUTED_GREEN_HUE_OUT, hue)) *
    fadeOut(MUTED_GREEN_SATURATION_OUT, saturation) *
    fadeOut(MUTED_GREEN_BRIGHTNESS_OUT, brightness)
  );
}

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
 * Nearly gray colors are shown with the bulb's white LEDs (`temp`) instead of RGB. Muted greens skip the boost and
 * gamma and get cool white (`mutedGreenCorrection`).
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
    const colorful = clamp01((saturation - o.whiteSaturation - WHITE_HYSTERESIS) / COLOR_BASE_SATURATION_RAMP);
    const visible = clamp01((value - threshold) / COLOR_BASE_BRIGHTNESS_RAMP);
    const colorBase = clamp(o.colorBaseBrightness, minDimming, maxDimming);
    const base = minDimming + (colorBase - minDimming) * colorful * visible;
    dimming = base + (maxDimming - base) * t ** Math.max(0.01, o.brightnessGamma);
  }
  dimming = Math.round(clamp(dimming, minDimming, maxDimming));

  const whiteBelow = o.whiteSaturation + (context.wasWhite ? WHITE_HYSTERESIS : 0);
  if (o.whiteSaturation > 0 && saturation < whiteBelow) {
    return { r: 255, g: 255, b: 255, dimming, temp: Math.round(clamp(o.whiteTemp, WIZ_MIN_TEMP, WIZ_MAX_TEMP)) };
  }

  const paleWhite = clamp(o.paleWhite, 0, 255);
  // 1 = the screen's own saturation on cool white. Only the color changes: white mode and dimming are decided above.
  const correction = paleWhite > 0 ? clamp01(o.mutedGreenCorrection) * mutedGreenAmount(hsv.h, hsv.s, value) : 0;
  const shownSaturation = saturation + (hsv.s - saturation) * correction;
  const baseGamma = o.gamma > 0 ? o.gamma : 1; // 0 = no gamma
  const gamma = baseGamma + (1 - baseGamma) * correction;

  let { r, g, b } = hsvToRgb({ h: hsv.h, s: shownSaturation, v: 1 });
  if (gamma !== 1) {
    r = 255 * (r / 255) ** gamma;
    g = 255 * (g / 255) ** gamma;
    b = 255 * (b / 255) ** gamma;
  }

  if (paleWhite === 0) {
    return { r: Math.round(clamp(r, 0, 255)), g: Math.round(clamp(g, 0, 255)), b: Math.round(clamp(b, 0, 255)), dimming };
  }
  return { ...encodePale({ r, g, b }, paleWhite, correction), dimming };
}

// How the WiZ app encodes a color, fitted to readings of the app's own colors (docs/WIZ_PROTOCOL.md, "Pale
// colors"). The hue goes on r,g,b at a level that rises with saturation s; the paleness goes on the white LEDs.
/** Hue level (fraction of 255) at s = 0: the app keeps a trace of the hue even for white (#ffffff → r 26). */
const PALE_HUE_FLOOR = 0.1;
/** Hue level at s = 0.5, where the white starts to fade out. */
const PALE_HUE_AT_HALF = 0.55;
/** From this saturation the hue is at full strength (measured at 0.75). */
const PALE_FULL_HUE_FROM = 0.75;

/** Hue level (0–1) for saturation s: 0.1 + 0.9 s up to s = 0.5, then up to 1 at s = 0.75. */
function paleHueLevel(s: number): number {
  if (s <= 0.5) return PALE_HUE_FLOOR + (PALE_HUE_AT_HALF - PALE_HUE_FLOOR) * (s / 0.5);
  if (s >= PALE_FULL_HUE_FROM) return 1;
  // Not measured between 0.5 and 0.75 (the app may jump); a ramp keeps the light from stepping here.
  return PALE_HUE_AT_HALF + ((1 - PALE_HUE_AT_HALF) * (s - 0.5)) / (PALE_FULL_HUE_FROM - 0.5);
}

/** White level for saturation s: `paleWhite` up to s = 0.5, then down to 0 at s = 1. */
function paleWhiteLevel(s: number, paleWhite: number): number {
  return s <= 0.5 ? paleWhite : paleWhite * 2 * (1 - s);
}

/**
 * Share of the white that goes to the cold LEDs (`c`), by hue: 0 at red, rising to 1 at blue (240°), back to 0
 * at red, so warm hues get warm white and cool hues get cold white, as in the WiZ app.
 */
export function paleColdShare(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  return h <= 240 ? h / 240 : (360 - h) / 120;
}

/**
 * Splits a color into the WiZ app's encoding: the pure hue on `r,g,b` at a level that grows with saturation,
 * and the paleness on the white LEDs, tinted warm or cold by the hue. A gray has hue 0° (red), as in the app.
 * `cool` (0–1) departs from the app: it moves the white toward the cold LEDs without changing its total.
 */
function encodePale(color: Rgb, paleWhite: number, cool: number): { r: number; g: number; b: number; c: number; w: number } {
  const { h, s } = rgbToHsv(color);
  const pure = hsvToRgb({ h, s: 1, v: 1 });
  const level = paleHueLevel(s);
  const white = Math.round(clamp(paleWhiteLevel(s, paleWhite), 0, 255));
  const share = paleColdShare(h);
  const c = Math.round(white * (share + (1 - share) * cool));
  return {
    r: Math.round(clamp(pure.r * level, 0, 255)),
    g: Math.round(clamp(pure.g * level, 0, 255)),
    b: Math.round(clamp(pure.b * level, 0, 255)),
    c,
    w: white - c,
  };
}

/**
 * The color a `WizColor` shows, for previews and logs: undoes the hue + white encoding of `calibrate`
 * (pass the same `paleWhite`). Colors without white channels are returned as they are; white mode (`temp`)
 * returns its `r,g,b` preview.
 */
export function previewRgb(color: WizColor, paleWhite: number = DEFAULT_CALIBRATION.paleWhite): Rgb {
  const white = (color.c ?? 0) + (color.w ?? 0);
  if (color.temp !== undefined || white <= 0 || paleWhite <= 0) return { r: color.r, g: color.g, b: color.b };

  const max = Math.max(color.r, color.g, color.b);
  // Full white: s ≤ 0.5, read s from the hue level. Less white: s > 0.5, read s from the white.
  const s =
    white >= paleWhite - 0.5
      ? clamp((0.5 * (max / 255 - PALE_HUE_FLOOR)) / (PALE_HUE_AT_HALF - PALE_HUE_FLOOR), 0, 0.5)
      : clamp(1 - white / (2 * paleWhite), 0.5, 1);
  const pure = (v: number): number => (max > 0 ? (v / max) * 255 : 0);
  const mix = (v: number): number => 255 * (1 - s) + s * pure(v);
  return { r: mix(color.r), g: mix(color.g), b: mix(color.b) };
}
