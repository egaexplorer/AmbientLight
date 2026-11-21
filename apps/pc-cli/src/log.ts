import type { FrameReport, Rgb, WizColor } from "@ambientlight/core";

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

export function formatColor(color: WizColor): string {
  return `${toHex(color)} rgb(${color.r}, ${color.g}, ${color.b}) dim ${color.dimming}%`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  constructor(verbose: boolean) {
    this.verbose = verbose;
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
      `${swatch(report.output)}${formatColor(report.output)}` +
      `  | capture ${report.captureMs.toFixed(0)} ms | ${this.fps > 0 ? this.fps.toFixed(1) : "--"} fps | sent ${this.sent}/${this.frames}`;

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
