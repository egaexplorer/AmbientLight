import { type FrameReport, type PilotState, previewRgb, type Rgb, type WizColor } from "@ambientlight/core";
import { errorMessage } from "@ambientlight/node";

const isTty = process.stdout.isTTY === true;
const useColor = isTty && process.env.NO_COLOR === undefined;

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** A small block filled with the color (24-bit ANSI; works in Windows Terminal and VS Code). */
export function swatch(color: Rgb): string {
  if (!useColor) return "";
  const [r, g, b] = [color.r, color.g, color.b].map((v) => Math.round(v));
  return `\x1b[48;2;${r};${g};${b}m    \x1b[0m `;
}

/** Swatch of the color a `WizColor` shows (pale colors are sent as hue + white LEDs). */
export function colorSwatch(color: WizColor, paleWhite?: number): string {
  return swatch(color.temp !== undefined ? { r: 255, g: 255, b: 255 } : previewRgb(color, paleWhite));
}

/** e.g. `#ffbc85 = rgb(244, 110, 0) + w 128 dim 53%`: the color shown, then what the bulb is sent. */
export function formatColor(color: WizColor, paleWhite?: number): string {
  if (color.temp !== undefined) return `white ${color.temp} K dim ${color.dimming}%`;
  const rgb = `rgb(${color.r}, ${color.g}, ${color.b})`;
  const white = [color.c ? `c ${color.c}` : "", color.w ? `w ${color.w}` : ""].filter(Boolean).join(" ");
  if (white === "") return `${toHex(color)} ${rgb} dim ${color.dimming}%`;
  return `${toHex(previewRgb(color, paleWhite))} = ${rgb} + ${white} dim ${color.dimming}%`;
}

/** A bulb's `getPilot` state in one line, with every color field as the bulb reports it. */
export function formatPilot(state: PilotState): string {
  if (state.state === false) return "off";
  const parts: string[] = [];
  if (state.sceneId !== undefined && state.sceneId > 0) parts.push(`scene ${state.sceneId}`);
  if (state.temp !== undefined && state.temp > 0) parts.push(`temp ${state.temp} K`);
  for (const key of ["r", "g", "b", "c", "w"] as const) {
    if (state[key] !== undefined) parts.push(`${key} ${state[key]}`);
  }
  if (state.dimming !== undefined) parts.push(`dim ${state.dimming}%`);
  return parts.join("  ");
}

export { errorMessage };

/** Live one-line status for `sync`; prints a line per frame in verbose mode, once a second when not a TTY. */
export class StatusLine {
  private frames = 0;
  private sent = 0;
  private windowFrames = 0;
  private windowStart = Date.now();
  private lastPrint = 0;
  private fps = 0;
  private lastError = "";
  private lastErrorAt = 0;
  private readonly verbose: boolean;
  private readonly paleWhite: number | undefined;

  constructor(verbose: boolean, paleWhite?: number) {
    this.verbose = verbose;
    this.paleWhite = paleWhite;
  }

  update(report: FrameReport): void {
    this.frames++;
    this.windowFrames++;
    if (report.sent) this.sent++;

    const now = Date.now();
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this.fps = (this.windowFrames * 1000) / elapsed;
      this.windowFrames = 0;
      this.windowStart = now;
    }

    const line =
      `${colorSwatch(report.output, this.paleWhite)}${formatColor(report.output, this.paleWhite)}` +
      `  | capture ${report.captureMs.toFixed(0)} ms | ${this.fps > 0 ? this.fps.toFixed(1) : "--"} fps | sent ${this.sent}/${this.frames}` +
      (report.cut ? " | cut" : "");

    if (this.verbose) {
      console.log(line);
    } else if (isTty) {
      process.stdout.write(`\r\x1b[2K${line}`);
    } else if (now - this.lastPrint >= 1000) {
      this.lastPrint = now;
      console.log(line);
    }
  }

  /** Prints errors without flooding the terminal when every frame fails the same way. */
  error(error: unknown): void {
    const message = errorMessage(error);
    const now = Date.now();
    if (message === this.lastError && now - this.lastErrorAt < 5000) return;
    this.lastError = message;
    this.lastErrorAt = now;
    if (isTty && !this.verbose) process.stdout.write("\n");
    console.error(`Error: ${message}`);
  }

  end(): void {
    if (isTty && !this.verbose && this.frames > 0) process.stdout.write("\n");
  }
}
