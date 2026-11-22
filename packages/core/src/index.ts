// Color pipeline
export type { Hsv, PixelFrame, Rgb, WizColor } from "./color/types.js";
export { clamp, clamp01, hsvToRgb, linearToSrgb, rgbToHsv, srgbToLinear } from "./color/convert.js";
export {
  type AnalyzeOptions,
  analyzeFrame,
  type AverageOptions,
  averageColor,
  type ColorMode,
  type FrameColors,
  frameChange,
  HUE_STICKINESS,
} from "./color/average.js";
export {
  type CalibrationContext,
  type CalibrationOptions,
  calibrate,
  DEFAULT_CALIBRATION,
  paleColdShare,
  previewRgb,
  WHITE_HYSTERESIS,
} from "./color/calibration.js";
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
  isSignedResponse,
  type PilotState,
  parseResponse,
  pilotToRestoreParams,
  sanitizeSetPilot,
  setPilotMessage,
  type SetPilotParams,
  WIZ_ERROR_INVALID_PARAMS,
  WIZ_ERROR_METHOD_NOT_FOUND,
  WIZ_ERROR_SECURITY,
  type WizResponse,
} from "./wiz/protocol.js";
export type { RemoteInfo, UdpSocket } from "./wiz/socket.js";
export {
  WizLight,
  type WizLightOptions,
  type WizRequestOptions,
  WizResponseError,
  WizTimeoutError,
} from "./wiz/light.js";
export { type DiscoveredBulb, type DiscoverOptions, discoverBulbs } from "./wiz/discovery.js";
export {
  BULB_KIND_LABELS,
  type BulbKind,
  bulbKindFromModule,
  type ModelConfig,
  type SystemConfig,
} from "./wiz/device.js";
export {
  type BulbCheckOptions,
  type BulbCheckReport,
  type BulbVerdict,
  checkBulb,
  DEFAULT_TEST_COLOR,
  type RestoreResult,
  type TestColorResult,
} from "./wiz/check.js";

// Rain signal
export {
  type AirportObservation,
  assessRain,
  clockTime,
  type ForecastSlot,
  insidePolygon,
  type LatLon,
  type RainAssessment,
  type RainLevel,
  type WeatherAlert,
  type WeatherSnapshot,
} from "./weather/rain.js";

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
