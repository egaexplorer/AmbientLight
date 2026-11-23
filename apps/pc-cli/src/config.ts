import {
  type AppConfig,
  applyConfigFile,
  CALIBRATION_RANGES,
  CAPTURE_BACKENDS,
  COLOR_MODES,
  type ConfigFile,
  checkChoice,
  checkConfigLimits,
  checkNumber,
  RANGES,
} from "@ambientlight/node";
import type { CliFlags } from "./cli.js";

export {
  type AppConfig,
  CAPTURE_BACKENDS,
  type CaptureBackend,
  COLOR_MODES,
  CONFIG_FILE_NAME,
  type ConfigFile,
  DEFAULT_CONFIG,
  findConfigFile,
  loadConfigFile,
  validateConfigFile,
} from "@ambientlight/node";

/** Defaults ← config file ← command-line flags. */
export function resolveConfig(file: ConfigFile | undefined, flags: CliFlags): AppConfig {
  const config = applyConfigFile(file);

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
  return checkConfigLimits(config);
}
