import type { PixelFrame, ScreenCapturer } from "@ambientlight/core";
import screenshot from "screenshot-desktop";
import sharp from "sharp";

export interface DesktopCapturerOptions {
  /** Display id from `ambientlight displays`. Defaults to the primary display. */
  screen?: string | number | undefined;
  /** Downscaled size used for color averaging. */
  width: number;
  height: number;
}

/**
 * Phase 1–3 capture backend: screenshot-desktop grabs the display as JPEG,
 * sharp decodes and downscales it to a tiny raw RGB frame.
 *
 * screenshot-desktop spawns a helper process per frame (~50–200 ms on Windows),
 * which caps real throughput around 5–10 FPS. Phase 4 replaces this with
 * Electron's desktopCapturer behind the same ScreenCapturer interface.
 */
export class DesktopCapturer implements ScreenCapturer {
  private readonly options: DesktopCapturerOptions;

  constructor(options: DesktopCapturerOptions) {
    this.options = options;
  }

  async capture(): Promise<PixelFrame> {
    const image = await screenshot({
      format: "jpg",
      ...(this.options.screen !== undefined ? { screen: this.options.screen } : {}),
    });

    const { data, info } = await sharp(image)
      .resize(this.options.width, this.options.height, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height, channels: info.channels === 4 ? 4 : 3 };
  }
}

export async function listDisplays(): Promise<Array<{ id: string | number; name: string }>> {
  const displays = await screenshot.listDisplays();
  return displays.map((d) => ({ id: d.id, name: d.name }));
}
