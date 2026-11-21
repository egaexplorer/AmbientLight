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
 * Fallback capture backend (`"capture": "screenshot-desktop"`): screenshot-desktop grabs the display as JPEG,
 * sharp decodes and downscales it to a tiny raw RGB frame. Works on Windows, macOS and Linux.
 *
 * Slow on Windows: screenshot-desktop 1.15 writes its C# helper into a new temp folder for every frame, so every
 * frame starts cmd.exe, compiles the helper, starts it and encodes a full-size JPEG (measured ~370 ms per frame,
 * ~690 ms with `screen` set, because it also re-lists the displays). The default `"gdi"` backend
 * (`gdi-capture.ts`) keeps one helper running instead.
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
