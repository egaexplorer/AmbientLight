// Node.js adapters shared by the CLI and the desktop app (Windows). The platform-agnostic logic is in
// @ambientlight/core; this package only adds what needs Node.js: UDP, screen capture, files and HTTP.
export {
  type AppConfig,
  applyConfigFile,
  CALIBRATION_RANGES,
  CAPTURE_BACKENDS,
  type CaptureBackend,
  checkChoice,
  checkConfigLimits,
  checkNumber,
  COLOR_MODES,
  CONFIG_FILE_NAME,
  type ConfigFile,
  DEFAULT_CONFIG,
  findConfigFile,
  loadConfigFile,
  RANGES,
  type Range,
  saveConfigFile,
  syncOptionsFor,
  toConfigFile,
  validateConfigFile,
} from "./config.js";
export { type DisplayInfo, listDisplays } from "./displays.js";
export { errorMessage, UserError } from "./errors.js";
export {
  type ChosenLook,
  defaultCacheDir,
  findTitle,
  lookForTitle,
  pickFilm,
  pickGame,
  pickSeries,
  splitYear,
  TitleError,
  type TitleErrorCode,
  type TitleInfo,
  type TitleKind,
} from "./film.js";
export { defaultHelperSource, ensureHelper, FrameAssembler, GdiCapturer, type GdiCapturerOptions } from "./gdi-capture.js";
export { broadcastAddresses, intToIpv4, ipv4ToInt, subnetBroadcast } from "./network.js";
export { createNodeUdpSocket, type NodeUdpSocketOptions } from "./udp.js";
