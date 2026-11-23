import { parseArgs } from "node:util";
import { LOOK_NAMES, type LookName } from "@ambientlight/core";
import { UserError as CliError } from "@ambientlight/node";

export const COMMANDS = ["discover", "check", "state", "on", "off", "displays", "color", "once", "sync", "rain", "help"] as const;
export type Command = (typeof COMMANDS)[number];

export const SIMULATIONS = ["go", "prepare", "wait", "danger", "unknown"] as const;
export type SimulatedWeather = (typeof SIMULATIONS)[number];

/** A user-facing error: printed without a stack trace. The same class as the shared packages throw. */
export { UserError as CliError } from "@ambientlight/node";

export interface CliFlags {
  bulbs?: string[];
  config?: string;
  fps?: number;
  capture?: string;
  screen?: string | number;
  smoothing?: number;
  colorWeighting?: number;
  colorMode?: string;
  minChange?: number;
  sceneCut?: number;
  saturation?: number;
  gamma?: number;
  minDimming?: number;
  maxDimming?: number;
  colorBase?: number;
  whiteSaturation?: number;
  whiteTemp?: number;
  paleWhite?: number;
  mutedGreen?: number;
  noRestore: boolean;
  timeoutMs?: number;
  saveFrame?: string;
  film?: string;
  series?: string;
  look?: LookName;
  plan?: string;
  simulate?: SimulatedWeather;
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
  check               Test a bulb: reply time, model, firmware, and whether it accepts colors
                      (npm run check-bulb; checks every bulb found if none is configured)
  state               Show each bulb's current color exactly as the bulb reports it (changes nothing)
  on / off            Turn the bulbs on (last color and brightness) or off; an off bulb stays reachable
  displays            List displays available for capture
  color               Set a fixed color to test a bulb   (--rgb 255,0,0 [--dimming 80])
  once                Capture one frame and send its color (Phase 1)
  sync                Continuously sync the screen to the bulbs (Phase 2)
  rain                Show on the bulb whether it's a good time to head out (BMKG, METAR, optional AI)
  help                Show this help

Options:
  -b, --bulb <ip>         Bulb IP; repeat or comma-separate for several bulbs
  -c, --config <file>     Config file (default: ambientlight.config.json, searched upward)
      --fps <n>           Updates per second (default 20, the most measured to work on a WiZ bulb)
      --capture <name>    "gdi": fast helper that stays running (Windows, default);
                          "screenshot-desktop": slower fallback, any OS
      --screen <id>       Display id from "displays" (default: primary display)
      --smoothing <0-1>   Share of a color change shown per 100 ms; 1 = no smoothing (default 0.7)
      --color-weighting <0-1>  How much colorful areas outweigh gray ones for the hue (default 0.6)
      --color-mode <mode> "dominant": strongest color on screen; "average": all colors mixed (default dominant)
      --min-change <n>    Skip updates smaller than this, 0-255 (default 4)
      --scene-cut <n>     Mean pixel change, 0-255, shown at once instead of faded; 0 = never (default 40)
      --saturation <n>    Saturation boost (default 1.3)
      --gamma <n>         Color gamma (default 1.6)
      --min-dimming <n>   Dimming for dark scenes, 10-100 (default 10)
      --max-dimming <n>   Dimming for bright scenes, 10-100 (default 100)
      --color-base <n>    Dimming that dark colored scenes start from, 10-100 (default 10)
      --white-saturation <0-1>  Below this saturation use the white LEDs; 0 = never (default 0.15)
      --white-temp <K>    Color temperature for white, 2200-6500 (default 5000)
      --pale-white <n>    White LED level for pale colors, 0-255; 0 = RGB only (default 140)
      --muted-green <0-1> Cool white for muted green scenes instead of yellow; 0 = off (default 1)
      --no-restore        Don't restore the bulbs' previous state (sync, check)
      --timeout <ms>      How long "discover" (and "check" without a bulb) listens for replies (default 2000)
      --film <title>      Film look from the genre on Wikipedia (sync, once), e.g. --film "Pengabdi Setan"
      --series <title>    Film look from a TV series' genre on TVmaze
      --look <name>       Pick the film look yourself: ${LOOK_NAMES.slice(0, 4).join(", ")},
                          ${LOOK_NAMES.slice(4).join(", ")}
      --save-frame <file> Save the frame "once" analyzed as a PNG, to study a scene
      --plan <text>       Your plan for "rain", for the AI (e.g. "naik motor, bisa tunggu sampai 19:00")
      --simulate <name>   Made-up weather for "rain": go, prepare, wait, danger or unknown
      --rgb <r,g,b>       Color for "color", or the test color for "check" (default 255,0,0)
      --dimming <n>       Dimming for "color" and "check" (default 100)
  -v, --verbose           Print every frame
  -h, --help              Show this help

Examples:
  npm run discover
  npm run check-bulb -- --bulb 192.168.1.50
  npm run state
  npm run off
  npm run color -- --bulb 192.168.1.50 --rgb 255,0,0
  npm run sync -- --bulb 192.168.1.50 --fps 10
  npm run sync -- --film "Pengabdi Setan"`;

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

function parseLook(raw: string | undefined): LookName | undefined {
  if (raw === undefined) return undefined;
  if (!(LOOK_NAMES as readonly string[]).includes(raw)) {
    throw new CliError(`--look expects one of ${LOOK_NAMES.join(", ")}, got "${raw}"`);
  }
  return raw as LookName;
}

function parseSimulation(raw: string | undefined): SimulatedWeather | undefined {
  if (raw === undefined) return undefined;
  if (!(SIMULATIONS as readonly string[]).includes(raw)) {
    throw new CliError(`--simulate expects one of ${SIMULATIONS.join(", ")}, got "${raw}"`);
  }
  return raw as SimulatedWeather;
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
        capture: { type: "string" },
        screen: { type: "string" },
        smoothing: { type: "string" },
        "color-weighting": { type: "string" },
        "color-mode": { type: "string" },
        "min-change": { type: "string" },
        "scene-cut": { type: "string" },
        saturation: { type: "string" },
        gamma: { type: "string" },
        "min-dimming": { type: "string" },
        "max-dimming": { type: "string" },
        "color-base": { type: "string" },
        "white-saturation": { type: "string" },
        "white-temp": { type: "string" },
        "pale-white": { type: "string" },
        "muted-green": { type: "string" },
        "no-restore": { type: "boolean", default: false },
        timeout: { type: "string" },
        "save-frame": { type: "string" },
        film: { type: "string" },
        series: { type: "string" },
        look: { type: "string" },
        plan: { type: "string" },
        simulate: { type: "string" },
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
  set("capture", values.capture);
  set("screen", parseScreen(values.screen));
  set("smoothing", toNumber("smoothing", values.smoothing));
  set("colorWeighting", toNumber("color-weighting", values["color-weighting"]));
  set("colorMode", values["color-mode"]);
  set("minChange", toNumber("min-change", values["min-change"]));
  set("sceneCut", toNumber("scene-cut", values["scene-cut"]));
  set("saturation", toNumber("saturation", values.saturation));
  set("gamma", toNumber("gamma", values.gamma));
  set("minDimming", toNumber("min-dimming", values["min-dimming"]));
  set("maxDimming", toNumber("max-dimming", values["max-dimming"]));
  set("colorBase", toNumber("color-base", values["color-base"]));
  set("whiteSaturation", toNumber("white-saturation", values["white-saturation"]));
  set("whiteTemp", toNumber("white-temp", values["white-temp"]));
  set("paleWhite", toNumber("pale-white", values["pale-white"]));
  set("mutedGreen", toNumber("muted-green", values["muted-green"]));
  set("timeoutMs", toNumber("timeout", values.timeout));
  set("saveFrame", values["save-frame"]);
  if (flags.saveFrame !== undefined && name !== "once") throw new CliError('--save-frame only works with "once"');
  set("film", values.film);
  set("series", values.series);
  set("look", parseLook(values.look));
  const lookFlags = [flags.film, flags.series, flags.look].filter((value) => value !== undefined).length;
  if (lookFlags > 1) throw new CliError("Use only one of --film, --series and --look");
  if (lookFlags === 1 && name !== "sync" && name !== "once") {
    throw new CliError('--film, --series and --look only work with "sync" and "once"');
  }
  set("plan", values.plan);
  if (flags.plan !== undefined && name !== "rain") throw new CliError('--plan only works with "rain"');
  set("simulate", parseSimulation(values.simulate));
  if (flags.simulate !== undefined && name !== "rain") throw new CliError('--simulate only works with "rain"');
  set("rgb", parseRgb(values.rgb));
  set("dimming", toNumber("dimming", values.dimming));

  return { command: name as Command, flags };
}
