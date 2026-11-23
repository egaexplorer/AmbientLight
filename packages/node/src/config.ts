import fs from "node:fs";
import path from "node:path";
import {
  applyLook,
  type CalibrationOptions,
  type ColorMode,
  DEFAULT_CALIBRATION,
  DEFAULT_SYNC_OPTIONS,
  DESIGN_BRIGHTNESS,
  type FilmLook,
  MAX_FPS,
  MIN_FPS,
  scaleBrightness,
  type SyncOptions,
} from "@ambientlight/core";
import { UserError } from "./errors.js";

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
  /**
   * Brightness setting, 10-100: 70 shows the look (or plain sync) as designed, and the top brightness scales
   * linearly with it, up to the bulb's 100 % (`scaleBrightness`).
   */
  brightness: number;
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
  brightness: DESIGN_BRIGHTNESS,
  weatherArea: undefined,
  calibration: { ...DEFAULT_CALIBRATION },
});

export type Range = readonly [min: number, max: number, integer?: boolean];

export const COLOR_MODES: readonly ColorMode[] = ["dominant", "average"];

export function checkChoice<T extends string>(name: string, value: unknown, choices: readonly T[], source: string): T {
  if (typeof value !== "string" || !(choices as readonly string[]).includes(value)) {
    throw new UserError(`${source}: "${name}" must be ${choices.map((m) => `"${m}"`).join(" or ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

export const RANGES = {
  fps: [MIN_FPS, MAX_FPS],
  sampleWidth: [1, 512, true],
  sampleHeight: [1, 512, true],
  smoothing: [0.01, 1],
  colorWeighting: [0, 1],
  minChange: [0, 255],
  sceneCut: [0, 255],
  keepAliveMs: [100, 60_000, true],
  brightness: [10, 100, true],
} as const satisfies Partial<Record<keyof AppConfig, Range>>;

export const CALIBRATION_RANGES = {
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

export function checkNumber(name: string, value: unknown, range: Range, source: string): number {
  const [min, max, integer] = range;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UserError(`${source}: "${name}" must be a number`);
  }
  if (value < min || value > max || (integer === true && !Number.isInteger(value))) {
    throw new UserError(`${source}: "${name}" must be ${integer ? "an integer " : ""}between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates a parsed config object. Unknown keys are rejected so typos don't fail silently. */
export function validateConfigFile(value: unknown, source: string): ConfigFile {
  if (!isRecord(value)) throw new UserError(`${source}: expected a JSON object`);
  const out: ConfigFile = {};

  for (const [key, raw] of Object.entries(value)) {
    switch (key) {
      case "$schema":
        break;
      case "bulbs":
        if (!Array.isArray(raw) || raw.some((ip) => typeof ip !== "string" || ip.trim() === "")) {
          throw new UserError(`${source}: "bulbs" must be an array of IP address strings`);
        }
        out.bulbs = raw.map((ip: string) => ip.trim());
        break;
      case "screen":
        if (raw !== null && typeof raw !== "string" && typeof raw !== "number") {
          throw new UserError(`${source}: "screen" must be a display id, or null for the primary display`);
        }
        out.screen = raw;
        break;
      case "weatherArea":
        if (raw !== null && (typeof raw !== "string" || !/^\d\d\.\d\d\.\d\d\.\d{4}$/.test(raw))) {
          throw new UserError(`${source}: "weatherArea" must be a BMKG village code like "31.71.03.1001", or null`);
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
        if (typeof raw !== "boolean") throw new UserError(`${source}: "restoreOnExit" must be true or false`);
        out.restoreOnExit = raw;
        break;
      case "calibration": {
        if (!isRecord(raw)) throw new UserError(`${source}: "calibration" must be an object`);
        const calibration: Partial<CalibrationOptions> = {};
        for (const [ck, cv] of Object.entries(raw)) {
          if (!(ck in CALIBRATION_RANGES)) throw new UserError(`${source}: unknown option "calibration.${ck}"`);
          const k = ck as keyof CalibrationOptions;
          calibration[k] = checkNumber(`calibration.${ck}`, cv, CALIBRATION_RANGES[k], source);
        }
        out.calibration = calibration;
        break;
      }
      default: {
        if (!(key in RANGES)) throw new UserError(`${source}: unknown option "${key}"`);
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
    throw new UserError(`Cannot read config file ${filePath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch (error) {
    throw new UserError(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateConfigFile(json, path.basename(filePath));
}

/** Defaults ← config file. */
export function applyConfigFile(file: ConfigFile | undefined): AppConfig {
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    bulbs: [...DEFAULT_CONFIG.bulbs],
    calibration: { ...DEFAULT_CONFIG.calibration },
  };
  if (file) {
    const { calibration, screen, weatherArea, ...rest } = file;
    Object.assign(config, rest);
    if (rest.bulbs) config.bulbs = [...rest.bulbs];
    if (screen !== undefined) config.screen = screen ?? undefined;
    if (weatherArea !== undefined) config.weatherArea = weatherArea ?? undefined;
    if (calibration) Object.assign(config.calibration, calibration);
  }
  return config;
}

/** Checks the rules that involve two settings. */
export function checkConfigLimits(config: AppConfig): AppConfig {
  const cal = config.calibration;
  if (cal.minDimming > cal.maxDimming) {
    throw new UserError(`minDimming (${cal.minDimming}) cannot be higher than maxDimming (${cal.maxDimming})`);
  }
  if (cal.colorBaseBrightness > cal.maxDimming) {
    throw new UserError(`colorBaseBrightness (${cal.colorBaseBrightness}) cannot be higher than maxDimming (${cal.maxDimming})`);
  }
  return config;
}

/**
 * The file form of a config: the bulbs plus every value that differs from the defaults, so later changes to the
 * defaults (Phase 3 tuning) still reach the user.
 */
export function toConfigFile(config: AppConfig): ConfigFile {
  const file: ConfigFile = { bulbs: [...config.bulbs] };
  const out = file as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>) {
    if (key === "bulbs" || key === "calibration") continue;
    const value = config[key];
    if (value !== DEFAULT_CONFIG[key]) out[key] = value ?? null;
  }
  const calibration: Partial<CalibrationOptions> = {};
  for (const key of Object.keys(DEFAULT_CONFIG.calibration) as Array<keyof CalibrationOptions>) {
    if (config.calibration[key] !== DEFAULT_CONFIG.calibration[key]) calibration[key] = config.calibration[key];
  }
  if (Object.keys(calibration).length > 0) file.calibration = calibration;
  return file;
}

/**
 * Validates a config and writes it as JSON (through a temporary file, so a crash can't leave half a file).
 * Returns the config as it will be read back.
 */
export function saveConfigFile(filePath: string, config: AppConfig): AppConfig {
  const file = toConfigFile(config);
  const checked = checkConfigLimits(applyConfigFile(validateConfigFile(JSON.parse(JSON.stringify(file)), path.basename(filePath))));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`);
  fs.renameSync(temp, filePath);
  return checked;
}

/** The `SyncEngine` options for a config: a film look on top of its calibration, then the brightness setting. */
export function syncOptionsFor(config: AppConfig, look?: FilmLook): Partial<SyncOptions> {
  return {
    fps: config.fps,
    smoothing: config.smoothing,
    colorWeighting: config.colorWeighting,
    colorMode: config.colorMode,
    minChange: config.minChange,
    sceneCut: config.sceneCut,
    keepAliveMs: config.keepAliveMs,
    calibration: scaleBrightness(look ? applyLook(config.calibration, look) : config.calibration, config.brightness / DESIGN_BRIGHTNESS),
    hueTarget: look?.hue,
  };
}
