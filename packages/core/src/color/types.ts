/** An sRGB color with 0–255 channels (may be fractional mid-pipeline). */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A color ready to send to a WiZ bulb: integer 0–255 channels plus dimming in percent (10–100). */
export interface WizColor extends Rgb {
  dimming: number;
  /**
   * When set, the bulb shows white from its dedicated white LEDs at this color temperature (Kelvin), and
   * `r,g,b` are only a preview for logs. White mixed from the RGB LEDs looks lavender on WiZ bulbs.
   */
  temp?: number;
}

/** HSV with hue in degrees [0, 360), saturation and value in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/**
 * A captured (usually downscaled) frame of packed 8-bit pixels in row-major order.
 * Platform capture adapters (screenshot-desktop + sharp, Electron desktopCapturer,
 * Android MediaProjection) all convert their output to this shape.
 */
export interface PixelFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** 3 = RGB, 4 = RGBA/BGRA (the 4th byte is ignored). */
  channels: 3 | 4;
  /** Byte order of the color channels. Some native capture APIs deliver BGRA. Defaults to "rgb". */
  order?: "rgb" | "bgr";
}
