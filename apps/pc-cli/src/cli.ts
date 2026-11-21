import { parseArgs } from "node:util";

export const COMMANDS = ["discover", "displays", "color", "once", "sync", "help"] as const;
export type Command = (typeof COMMANDS)[number];

/** A user-facing error: printed without a stack trace. */
export class CliError extends Error {
  override name = "CliError";
}

export interface CliFlags {
  bulbs?: string[];
  config?: string;
  fps?: number;
  screen?: string | number;
  smoothing?: number;
  minChange?: number;
  saturation?: number;
  gamma?: number;
  minDimming?: number;
  maxDimming?: number;
  noRestore: boolean;
  timeoutMs?: number;
  rgb?: { r: number; g: number; b: number };
  dimming?: number;
  verbose: boolean;
  help: boolean;
}

export interface ParsedCommandLine {
  command: Command;
  flags: CliFlags;
}

export const USAGE = `AmbientLight - sync Philips WiZ bulbs to your screen

Usage (from the repository root):
  npm run <command> -- [options]

Commands:
  discover            Find WiZ bulbs on your network
  displays            List displays available for capture
  color               Set a fixed color to test a bulb   (--rgb 255,0,0 [--dimming 80])
  once                Capture one frame and send its color (Phase 1)
  sync                Continuously sync the screen to the bulbs (Phase 2)
  help                Show this help

Options:
  -b, --bulb <ip>         Bulb IP; repeat or comma-separate for several bulbs
  -c, --config <file>     Config file (default: ambientlight.config.json, searched upward)
      --fps <n>           Updates per second (default 10; WiZ bulbs handle ~5-15)
      --screen <id>       Display id from "displays" (default: primary display)
      --smoothing <0-1>   Weight of the newest frame; 1 = no smoothing (default 0.5)
      --min-change <n>    Skip updates smaller than this, 0-255 (default 4)
      --saturation <n>    Saturation boost (default 1.3)
      --gamma <n>         Color gamma (default 1.6)
      --min-dimming <n>   Dimming for dark scenes, 10-100 (default 10)
      --max-dimming <n>   Dimming for bright scenes, 10-100 (default 100)
      --no-restore        Don't restore the bulbs' previous state when sync stops
      --timeout <ms>      How long "discover" listens for replies (default 2000)
      --rgb <r,g,b>       Color for the "color" command
      --dimming <n>       Dimming for the "color" command (default 100)
  -v, --verbose           Print every frame
  -h, --help              Show this help

Examples:
  npm run discover
  npm run color -- --bulb 192.168.1.50 --rgb 255,0,0
  npm run sync -- --bulb 192.168.1.50 --fps 10`;

function toNumber(flag: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    throw new CliError(`--${flag} expects a number, got "${raw}"`);
  }
  return value;
}

function parseRgb(raw: string | undefined): CliFlags["rgb"] {
  if (raw === undefined) return undefined;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new CliError(`--rgb expects three 0-255 integers like 255,120,0 — got "${raw}"`);
  }
  const [r, g, b] = parts as [number, number, number];
  return { r, g, b };
}

function parseScreen(raw: string | undefined): string | number | undefined {
  if (raw === undefined) return undefined;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        bulb: { type: "string", short: "b", multiple: true },
        config: { type: "string", short: "c" },
        fps: { type: "string" },
        screen: { type: "string" },
        smoothing: { type: "string" },
        "min-change": { type: "string" },
        saturation: { type: "string" },
        gamma: { type: "string" },
        "min-dimming": { type: "string" },
        "max-dimming": { type: "string" },
        "no-restore": { type: "boolean", default: false },
        timeout: { type: "string" },
        rgb: { type: "string" },
        dimming: { type: "string" },
        verbose: { type: "boolean", short: "v", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;
  const [first, ...extra] = positionals;
  if (extra.length > 0) throw new CliError(`Unexpected argument "${extra[0]}"`);

  const name = first ?? "help";
  if (!(COMMANDS as readonly string[]).includes(name)) {
    throw new CliError(`Unknown command "${name}". Run "npm run help" or see --help.`);
  }

  const bulbs = values.bulb
    ?.flatMap((entry) => entry.split(","))
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);

  const flags: CliFlags = {
    noRestore: values["no-restore"],
    verbose: values.verbose,
    help: values.help,
  };
  const set = <K extends keyof CliFlags>(key: K, value: CliFlags[K] | undefined): void => {
    if (value !== undefined) flags[key] = value;
  };
  set("bulbs", bulbs);
  set("config", values.config);
  set("fps", toNumber("fps", values.fps));
  set("screen", parseScreen(values.screen));
  set("smoothing", toNumber("smoothing", values.smoothing));
  set("minChange", toNumber("min-change", values["min-change"]));
  set("saturation", toNumber("saturation", values.saturation));
  set("gamma", toNumber("gamma", values.gamma));
  set("minDimming", toNumber("min-dimming", values["min-dimming"]));
  set("maxDimming", toNumber("max-dimming", values["max-dimming"]));
  set("timeoutMs", toNumber("timeout", values.timeout));
  set("rgb", parseRgb(values.rgb));
  set("dimming", toNumber("dimming", values.dimming));

  return { command: name as Command, flags };
}
