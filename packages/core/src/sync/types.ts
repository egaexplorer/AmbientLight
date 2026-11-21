import type { PixelFrame, WizColor } from "../color/types.js";

/**
 * Platform screen-capture adapter. Implementations should return a small, already
 * downscaled frame (e.g. 64×36) — averaging a full 4K frame in JS every 100 ms is wasteful.
 */
export interface ScreenCapturer {
  capture(): Promise<PixelFrame>;
  close?(): Promise<void>;
}

/** Anything that can display a color — a WizLight, a group of lights, or a UI preview. */
export interface ColorSink {
  setColor(color: WizColor): Promise<void>;
}
