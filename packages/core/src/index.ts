// Color pipeline
export type { Hsv, PixelFrame, Rgb, WizColor } from "./color/types.js";
export { clamp, clamp01, hsvToRgb, linearToSrgb, rgbToHsv, srgbToLinear } from "./color/convert.js";
export { type AverageOptions, averageColor } from "./color/average.js";
export { type CalibrationOptions, calibrate, DEFAULT_CALIBRATION } from "./color/calibration.js";
export { colorDistance, EmaSmoother } from "./color/smoothing.js";

// WiZ local UDP protocol
export {
  WIZ_BROADCAST,
  WIZ_MAX_DIMMING,
  WIZ_MAX_TEMP,
  WIZ_MIN_DIMMING,
  WIZ_MIN_TEMP,
  WIZ_PORT,
} from "./wiz/constants.js";
export {
  encodeMessage,
  getPilotMessage,
  type PilotState,
  parseResponse,
  pilotToRestoreParams,
  sanitizeSetPilot,
  setPilotMessage,
  type SetPilotParams,
  type WizResponse,
} from "./wiz/protocol.js";
export type { RemoteInfo, UdpSocket } from "./wiz/socket.js";
export { WizLight, type WizLightOptions, WizTimeoutError } from "./wiz/light.js";
export { type DiscoveredBulb, type DiscoverOptions, discoverBulbs } from "./wiz/discovery.js";

// Sync loop
export type { ColorSink, ScreenCapturer } from "./sync/types.js";
export {
  DEFAULT_SYNC_OPTIONS,
  type FrameReport,
  MAX_FPS,
  MIN_FPS,
  RECOMMENDED_MAX_FPS,
  SyncEngine,
  type SyncEvents,
  type SyncOptions,
} from "./sync/engine.js";

// Platform helpers
export { type Clock, clearTimer, setTimer, sleep, systemClock, type TimerHandle } from "./platform/timers.js";
