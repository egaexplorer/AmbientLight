import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PixelFrame, ScreenCapturer } from "@ambientlight/core";

/** C# source of the helper. `../native/` resolves to `apps/pc-cli/native/` from both `src/` and `dist/`. */
const SOURCE = fileURLToPath(new URL("../native/gdi-capture.cs", import.meta.url));
const REQUEST = Buffer.of(1);

export interface GdiCapturerOptions {
  /** Display id from `ambientlight displays` (e.g. `\\.\DISPLAY2`). Defaults to the primary display. */
  screen?: string | number | undefined;
  /** Size the helper shrinks the screen to. */
  width: number;
  height: number;
  /** Give up on a frame after this long and restart the helper. Default 2000 ms. */
  timeoutMs?: number;
}

/** Splits the helper's stdout stream into fixed-size frames. */
export class FrameAssembler {
  readonly frameBytes: number;
  private chunks: Buffer[] = [];
  private length = 0;

  constructor(frameBytes: number) {
    this.frameBytes = frameBytes;
  }

  /** Adds a chunk and returns the frames it completed (usually none or one). */
  push(chunk: Buffer): Buffer[] {
    this.chunks.push(chunk);
    this.length += chunk.length;
    if (this.length < this.frameBytes) return [];

    let rest = Buffer.concat(this.chunks, this.length);
    const frames: Buffer[] = [];
    while (rest.length >= this.frameBytes) {
      frames.push(rest.subarray(0, this.frameBytes));
      rest = rest.subarray(this.frameBytes);
    }
    this.chunks = rest.length > 0 ? [rest] : [];
    this.length = rest.length;
    return frames;
  }

  reset(): void {
    this.chunks = [];
    this.length = 0;
  }
}

function findCsc(): string {
  const windows = process.env.WINDIR ?? "C:\\Windows";
  for (const framework of ["Framework64", "Framework"]) {
    const csc = path.join(windows, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
    if (fs.existsSync(csc)) return csc;
  }
  throw new Error(
    'Can\'t find the C# compiler of the .NET Framework 4 (csc.exe), which the "gdi" capture needs. ' +
      'Use "capture": "screenshot-desktop" instead.',
  );
}

/**
 * Path of the compiled helper, compiling it first if needed. The exe is cached in
 * `%LOCALAPPDATA%\AmbientLight\` under a hash of its source, so it's built once and rebuilt when the source changes.
 */
export async function ensureHelper(): Promise<string> {
  const source = await fs.promises.readFile(SOURCE);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const dir = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "AmbientLight");
  const exe = path.join(dir, `gdi-capture-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;

  await fs.promises.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `gdi-capture-${hash}.${process.pid}.tmp.exe`);
  await new Promise<void>((resolve, reject) => {
    execFile(findCsc(), ["/nologo", "/optimize+", `/out:${temp}`, SOURCE], { windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error(`Couldn't compile the screen capture helper: ${stdout.trim() || error.message}`));
      else resolve();
    });
  });
  try {
    await fs.promises.rename(temp, exe);
  } catch (error) {
    // Another AmbientLight process compiled it at the same time.
    await fs.promises.rm(temp, { force: true });
    if (!fs.existsSync(exe)) throw error;
  }
  return exe;
}

interface PendingFrame {
  resolve(data: Buffer): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * Windows capture through a small C# helper (`native/gdi-capture.cs`) that stays running: it copies the display
 * with GDI and shrinks it to `width × height` itself, so each frame costs one screen copy (~30 ms at 1080p) and
 * ~9 KB over a pipe. screenshot-desktop instead starts and compiles its helper and encodes a full-size JPEG for
 * every frame (~370 ms).
 */
export class GdiCapturer implements ScreenCapturer {
  private readonly options: GdiCapturerOptions;
  private readonly assembler: FrameAssembler;
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<ChildProcessWithoutNullStreams> | undefined;
  private pending: PendingFrame | undefined;
  private stderr = "";

  constructor(options: GdiCapturerOptions) {
    this.options = options;
    this.assembler = new FrameAssembler(options.width * options.height * 4);
  }

  async capture(): Promise<PixelFrame> {
    if (this.pending) throw new Error("A frame is already being captured");
    const child = await this.start();
    const timeoutMs = this.options.timeoutMs ?? 2000;
    const data = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop(new Error(`The screen capture helper didn't answer within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      child.stdin.write(REQUEST);
    });
    return { data, width: this.options.width, height: this.options.height, channels: 4, order: "bgr" };
  }

  async close(): Promise<void> {
    const child = this.child ?? (await this.starting?.catch(() => undefined));
    if (!child) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.stdin.end();
    this.stop(new Error("The screen capture helper was closed"));
    await closed;
  }

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child) return Promise.resolve(this.child);
    this.starting ??= this.spawnHelper().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async spawnHelper(): Promise<ChildProcessWithoutNullStreams> {
    const exe = await ensureHelper();
    const args = [String(this.options.width), String(this.options.height)];
    if (this.options.screen !== undefined) args.push(String(this.options.screen));

    const child = spawn(exe, args, { windowsHide: true });
    this.stderr = "";
    this.assembler.reset();
    child.stdout.on("data", (chunk: Buffer) => {
      if (child !== this.child) return;
      for (const frame of this.assembler.push(chunk)) this.settle((p) => p.resolve(frame));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-1000);
    });
    // Writing after the helper died raises EPIPE here; "close" below reports the failure.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => this.stop(error, child));
    child.on("close", (code) => {
      const detail = this.stderr.trim();
      this.stop(new Error(`The screen capture helper stopped (exit code ${code})${detail ? `: ${detail}` : ""}`), child);
    });
    this.child = child;
    return child;
  }

  private settle(fn: (pending: PendingFrame) => void): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    fn(pending);
  }

  /**
   * Fails the frame in flight and drops the helper; the next `capture()` starts a new one. Events from a helper
   * that was already dropped are ignored, so they can't fail a frame of its replacement.
   */
  private stop(error: Error, child = this.child): void {
    if (child !== this.child) return;
    if (child) {
      this.child = undefined;
      child.kill();
    }
    this.settle((p) => p.reject(error));
  }
}
