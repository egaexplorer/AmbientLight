import path from "node:path";
import type { PixelFrame } from "@ambientlight/core";
import { CliError } from "./cli.js";
import { errorMessage } from "./log.js";

/**
 * Writes a frame as a lossless RGB PNG with exactly the pixels `analyzeFrame` sees, to study a scene offline
 * (`once --save-frame`). Relative paths start where the user typed the command, not in `apps/pc-cli`.
 */
export async function saveFramePng(frame: PixelFrame, file: string): Promise<string> {
  const { data, width, height, channels } = frame;
  const [r, g, b] = frame.order === "bgr" ? [2, 1, 0] : [0, 1, 2];
  const rgb = new Uint8Array(width * height * 3);
  for (let from = 0, to = 0; to < rgb.length; from += channels, to += 3) {
    rgb[to] = data[from + r]!;
    rgb[to + 1] = data[from + g]!;
    rgb[to + 2] = data[from + b]!; // the fourth byte of a GDI frame is unused, not alpha
  }

  const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
  try {
    // Loaded here, so the other commands still work if sharp's native binary failed to install.
    const { default: sharp } = await import("sharp");
    await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(target);
  } catch (error) {
    throw new CliError(`Couldn't save the frame to ${target}: ${errorMessage(error)}`);
  }
  return target;
}
