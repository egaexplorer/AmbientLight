/** `getSystemConfig.result`: hardware and firmware identity. Fields vary by firmware. */
export interface SystemConfig {
  mac?: string;
  /** Hardware module, e.g. `ESP25_SHRGB_01`. The middle part tells what the bulb can show. */
  moduleName?: string;
  fwVersion?: string;
  homeId?: number;
  roomId?: number;
  [key: string]: unknown;
}

/** `getModelConfig.result` (newer firmware only). */
export interface ModelConfig {
  /** Lowest accepted `dimming`; bulbs that don't report it use 10. */
  minDimLevel?: number;
  /** White temperature range in Kelvin, e.g. `[2200, 2700, 6500, 6500]`. */
  cctRange?: number[];
  [key: string]: unknown;
}

export type BulbKind = "color" | "tunable-white" | "dimmable-white" | "socket" | "unknown";

export const BULB_KIND_LABELS: Readonly<Record<BulbKind, string>> = Object.freeze({
  color: "full color",
  "tunable-white": "tunable white only",
  "dimmable-white": "dimmable white only",
  socket: "smart plug",
  unknown: "unknown type",
});

/**
 * Reads the bulb type from `moduleName` (e.g. `ESP25_SHRGB_01` → color). The middle segment names the
 * LED setup: `RGB` = color, `TW` = tunable white, `DW` = dimmable white, `SOCKET` = plug.
 */
export function bulbKindFromModule(moduleName: string | undefined): BulbKind {
  if (!moduleName) return "unknown";
  const parts = moduleName.toUpperCase().split("_");
  const type = parts.length > 1 ? (parts[1] ?? "") : (parts[0] ?? "");
  if (type.includes("SOCKET")) return "socket";
  if (type.includes("RGB")) return "color";
  if (type.includes("TW")) return "tunable-white";
  if (type.includes("DW")) return "dimmable-white";
  return "unknown";
}
