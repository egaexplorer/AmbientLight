import fs from "node:fs";
import path from "node:path";
import {
  type CalibrationOptions,
  type ColorMode,
  DEFAULT_CALIBRATION,
  DEFAULT_SYNC_OPTIONS,
  MAX_FPS,
  MIN_FPS,
} from "@ambientlight/core";
import { CliError, type CliFlags } from "./cli.js";

export const CONFIG_FILE_NAME = "ambientlight.config.json";

/**
 * Screen capture backend: `"gdi"` is a C# helper that stays running (Windows only, ~30 ms per frame);
 * `"screenshot-desktop"` starts a new process per frame (~370 ms on Windows) but works on every OS.
 */
export type CaptureBackend = "gdi" | "screenshot-desktop";
export const CAPTURE_BACKENDS: readonly CaptureBackend[] = ["gdi", "screenshot-desktop"];

export interface AppConfig {
  /** Bulb IP addresses (assign them a DHCP reservation in your router). */
  bulbs: string[];
  fps: number;
  capture: CaptureBackend;
  /** Display id from `ambientlight displays`; undefined = primary display. */
  screen: string | number | undefined;
  /** Size the screenshot is downscaled to before averaging. */
  sampleWidth: number;
  sampleHeight: number;
  smoothing: number;
  /** 0–1: how much more colorful pixels count when picking the hue. */
  colorWeighting: number;
  /** "dominant": hue from the strongest hue family on screen; "average": all colors mixed. */
  colorMode: ColorMode;
  minChange: number;
  /** Mean pixel change (0–255) that counts as a scene cut and is shown at once; 0 = never. */
  sceneCut: number;
  keepAliveMs: number;
  /** Put the bulbs back the way they were when sync stops. */
  restoreOnExit: boolean;
  /** BMKG village code (adm4) for `rain`. */
  weatherArea: string | undefined;
  calibration: CalibrationOptions;
}

/** Shape of ambientlight.config.json — every field optional. */
export type ConfigFile = Partial<Omit<AppConfig, "screen" | "weatherArea" | "calibration">> & {
  screen?: string | number | null;
  weatherArea?: string | null;
  calibration?: Partial<CalibrationOptions>;
};

export const DEFAULT_CONFIG: Readonly<AppConfig> = Object.freeze({
  bulbs: [],
  fps: DEFAULT_SYNC_OPTIONS.fps,
  capture: process.platform === "win32" ? "gdi" : "screenshot-desktop",
  screen: undefined,
  sampleWidth: 64,
  sampleHeight: 36,
  smoothing: DEFAULT_SYNC_OPTIONS.smoothing,
  colorWeighting: DEFAULT_SYNC_OPTIONS.colorWeighting,
  colorMode: DEFAULT_SYNC_OPTIONS.colorMode,
  minChange: DEFAULT_SYNC_OPTIONS.minChange,
  sceneCut: DEFAULT_SYNC_OPTIONS.sceneCut,
  keepAliveMs: DEFAULT_SYNC_OPTIONS.keepAliveMs,
  restoreOnExit: true,
  weatherArea: undefined,
  calibration: { ...DEFAULT_CALIBRATION },
});

type Range = readonly [min: number, max: number, integer?: boolean];

export const COLOR_MODES: readonly ColorMode[] = ["dominant", "average"];

function checkChoice<T extends string>(name: string, value: unknown, choices: readonly T[], source: string): T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
    throw new CliError(`${source}: "${name}" must be ${choices.map((m) => `"${m}"`).join(" or ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

const RANGES = {
  fps: [MIN_FPS, MAX_FPS],
  sampleWidth: [1, 512, true],
  sampleHeight: [1, 512, true],
  smoothing: [0.01, 1],
  colorWeighting: [0, 1],
  minChange: [0, 255],
  sceneCut: [0, 255],
  keepAliveMs: [100, 60_000, true],
} as const satisfies Partial<Record<keyof AppConfig, Range>>;

const CALIBRATION_RANGES = {
  saturationBoost: [0, 5],
  gamma: [0.1, 5],
  minDimming: [10, 100, true],
  maxDimming: [10, 100, true],
  colorBaseBrightness: [10, 100, true],
  brightnessGamma: [0.1, 5],
  blackThreshold: [0, 0.99],
  whiteSaturation: [0, 1],
  whiteTemp: [2200, 6500, true],
  paleWhite: [0, 255, true],
  mutedGreenCorrection: [0, 1],
} as const satisfies Record<keyof CalibrationOptions, Range>;

function checkNumber(name: string, value: unknown, range: Range, source: string): number {
  const [min, max, integer] = range;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CliError(`${source}: "${name}" must be a number`);
  }
  if (value < min || value > max || (integer === true && !Number.isInteger(value))) {
    throw new CliError(`${source}: "${name}" must be ${integer ? "an integer " : ""}between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a parsed config object. Unknown keys are rejected so typos don't fail silently. */
export function validateConfigFile(value: unknown, source: string): ConfigFile {
  if (!isRecord(value)) throw new CliError(`${source}: expected a JSON object`);
  const out: ConfigFile = {};

  for (const [key, raw] of Object.entries(value)) {
    switch (key) {
      case "$schema":
        break;
      case "bulbs":
        if (!Array.isArray(raw) || raw.some((ip) => typeof ip !== "string" || ip.trim() === "")) {
          throw new CliError(`${source}: "bulbs" must be an array of IP address strings`);
        }
        out.bulbs = raw.map((ip: string) => ip.trim());
        break;
      case "screen":
        if (raw !== null && typeof raw !== "string" && typeof raw !== "number") {
          throw new CliError(`${source}: "screen" must be a display id, or null for the primary display`);
        }
        out.screen = raw;
        break;
      case "weatherArea":
        if (raw !== null && (typeof raw !== "string" || !/^\d\d\.\d\d\.\d\d\.\d{4}$/.test(raw))) {
          throw new CliError(`${source}: "weatherArea" must be a BMKG village code like "31.71.03.1001", or null`);
        }
        out.weatherArea = raw;
        break;
      case "colorMode":
        out.colorMode = checkChoice("colorMode", raw, COLOR_MODES, source);
        break;
      case "capture":
        out.capture = checkChoice("capture", raw, CAPTURE_BACKENDS, source);
        break;
      case "restoreOnExit":
        if (typeof raw !== "boolean") throw new CliError(`${source}: "restoreOnExit" must be true or false`);
        out.restoreOnExit = raw;
        break;
      case "calibration": {
        if (!isRecord(raw)) throw new CliError(`${source}: "calibration" must be an object`);
        const calibration: Partial<CalibrationOptions> = {};
        for (const [ck, cv] of Object.entries(raw)) {
          if (!(ck in CALIBRATION_RANGES)) throw new CliError(`${source}: unknown option "calibration.${ck}"`);
          const k = ck as keyof CalibrationOptions;
          calibration[k] = checkNumber(`calibration.${ck}`, cv, CALIBRATION_RANGES[k], source);
        }
        out.calibration = calibration;
        break;
      }
      default: {
        if (!(key in RANGES)) throw new CliError(`${source}: unknown option "${key}"`);
        const k = key as keyof typeof RANGES;
        out[k] = checkNumber(key, raw, RANGES[k], source);
      }
    }
  }
  return out;
}

/** Looks for ambientlight.config.json in `startDir` and its parents. */
export function findConfigFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadConfigFile(filePath: string): ConfigFile {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new CliError(`Cannot read config file ${filePath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new CliError(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateConfigFile(json, path.basename(filePath));
}

/** Defaults ← config file ← command-line flags. */
export function resolveConfig(file: ConfigFile | undefined, flags: CliFlags): AppConfig {
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    bulbs: [...DEFAULT_CONFIG.bulbs],
    calibration: { ...DEFAULT_CONFIG.calibration },
  };

  if (file) {
    const { calibration, screen, weatherArea, ...rest } = file;
    Object.assign(config, rest);
    if (screen !== undefined) config.screen = screen ?? undefined;
    if (weatherArea !== undefined) config.weatherArea = weatherArea ?? undefined;
    if (calibration) Object.assign(config.calibration, calibration);
  }

  const source = "command line";
  if (flags.bulbs?.length) config.bulbs = flags.bulbs;
  if (flags.fps !== undefined) config.fps = checkNumber("--fps", flags.fps, RANGES.fps, source);
  if (flags.screen !== undefined) config.screen = flags.screen;
  if (flags.smoothing !== undefined) config.smoothing = checkNumber("--smoothing", flags.smoothing, RANGES.smoothing, source);
  if (flags.colorWeighting !== undefined) {
    config.colorWeighting = checkNumber("--color-weighting", flags.colorWeighting, RANGES.colorWeighting, source);
  }
  if (flags.colorMode !== undefined) config.colorMode = checkChoice("--color-mode", flags.colorMode, COLOR_MODES, source);
  if (flags.capture !== undefined) config.capture = checkChoice("--capture", flags.capture, CAPTURE_BACKENDS, source);
  if (flags.minChange !== undefined) config.minChange = checkNumber("--min-change", flags.minChange, RANGES.minChange, source);
  if (flags.sceneCut !== undefined) config.sceneCut = checkNumber("--scene-cut", flags.sceneCut, RANGES.sceneCut, source);
  if (flags.noRestore) config.restoreOnExit = false;

  const cal = config.calibration;
  if (flags.saturation !== undefined) {
    cal.saturationBoost = checkNumber("--saturation", flags.saturation, CALIBRATION_RANGES.saturationBoost, source);
  }
  if (flags.gamma !== undefined) cal.gamma = checkNumber("--gamma", flags.gamma, CALIBRATION_RANGES.gamma, source);
  if (flags.minDimming !== undefined) {
    cal.minDimming = checkNumber("--min-dimming", flags.minDimming, CALIBRATION_RANGES.minDimming, source);
  }
  if (flags.maxDimming !== undefined) {
    cal.maxDimming = checkNumber("--max-dimming", flags.maxDimming, CALIBRATION_RANGES.maxDimming, source);
  }
  if (flags.colorBase !== undefined) {
    cal.colorBaseBrightness = checkNumber("--color-base", flags.colorBase, CALIBRATION_RANGES.colorBaseBrightness, source);
  }
  if (flags.whiteSaturation !== undefined) {
    cal.whiteSaturation = checkNumber("--white-saturation", flags.whiteSaturation, CALIBRATION_RANGES.whiteSaturation, source);
  }
  if (flags.whiteTemp !== undefined) {
    cal.whiteTemp = checkNumber("--white-temp", flags.whiteTemp, CALIBRATION_RANGES.whiteTemp, source);
  }
  if (flags.paleWhite !== undefined) {
    cal.paleWhite = checkNumber("--pale-white", flags.paleWhite, CALIBRATION_RANGES.paleWhite, source);
  }
  if (flags.mutedGreen !== undefined) {
    cal.mutedGreenCorrection = checkNumber("--muted-green", flags.mutedGreen, CALIBRATION_RANGES.mutedGreenCorrection, source);
  }
  if (cal.minDimming > cal.maxDimming) {
    throw new CliError(`minDimming (${cal.minDimming}) cannot be higher than maxDimming (${cal.maxDimming})`);
  }
  if (cal.colorBaseBrightness > cal.maxDimming) {
    throw new CliError(`colorBaseBrightness (${cal.colorBaseBrightness}) cannot be higher than maxDimming (${cal.maxDimming})`);
  }

  return config;
}
