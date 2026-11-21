import { clamp } from "../color/convert.js";
import { WIZ_MAX_DIMMING, WIZ_MIN_DIMMING } from "./constants.js";

/**
 * Parameters accepted by `setPilot`. Every field is optional — send only what should change.
 * See docs/WIZ_PROTOCOL.md.
 */
export interface SetPilotParams {
  /** true = on, false = off. */
  state?: boolean;
  r?: number;
  g?: number;
  b?: number;
  /** Cold-white LED channel, 0–255. */
  c?: number;
  /** Warm-white LED channel, 0–255. */
  w?: number;
  /** White color temperature in Kelvin (≈2200–6500). */
  temp?: number;
  /** Brightness in percent, 10–100. */
  dimming?: number;
  /** Built-in scene (1–32). 0 = none. */
  sceneId?: number;
  /** Scene animation speed, 10–200 %. */
  speed?: number;
}

/** State returned in `getPilot.result`. */
export interface PilotState extends SetPilotParams {
  mac?: string;
  rssi?: number;
  src?: string;
}

export interface WizResponse<R = Record<string, unknown>> {
  method: string;
  id?: number;
  env?: string;
  result?: R;
  error?: { code: number; message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

/** Clamps and rounds values into the ranges WiZ firmware accepts; invalid values are a common source of silent failures. */
export function sanitizeSetPilot(params: SetPilotParams): SetPilotParams {
  const out: SetPilotParams = {};
  if (params.state !== undefined) out.state = params.state;
  if (params.r !== undefined) out.r = byte(params.r);
  if (params.g !== undefined) out.g = byte(params.g);
  if (params.b !== undefined) out.b = byte(params.b);
  if (params.c !== undefined) out.c = byte(params.c);
  if (params.w !== undefined) out.w = byte(params.w);
  if (params.temp !== undefined) out.temp = Math.round(clamp(params.temp, 1000, 10000));
  if (params.dimming !== undefined) {
    out.dimming = Math.round(clamp(params.dimming, WIZ_MIN_DIMMING, WIZ_MAX_DIMMING));
  }
  if (params.sceneId !== undefined) out.sceneId = Math.round(clamp(params.sceneId, 0, 1000));
  if (params.speed !== undefined) out.speed = Math.round(clamp(params.speed, 10, 200));
  return out;
}

export function encodeMessage(method: string, params: object = {}): string {
  return JSON.stringify({ method, params });
}

/** `{"method":"setPilot","params":{...}}` with values sanitized. */
export function setPilotMessage(params: SetPilotParams): string {
  return encodeMessage("setPilot", sanitizeSetPilot(params));
}

/** `{"method":"getPilot","params":{}}` — also used as the discovery broadcast. */
export function getPilotMessage(): string {
  return encodeMessage("getPilot");
}

/** Parses a bulb reply. Returns undefined for anything that is not a WiZ JSON response. */
export function parseResponse(text: string): WizResponse | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.method !== "string") return undefined;
  if (value.result !== undefined && !isRecord(value.result)) return undefined;
  return value as unknown as WizResponse;
}

/**
 * Builds the `setPilot` params that put a bulb back into the state reported by `getPilot`,
 * so the CLI can restore the user's lighting when sync stops.
 */
export function pilotToRestoreParams(state: PilotState): SetPilotParams {
  if (state.state === false) return { state: false };

  const params: SetPilotParams = { state: true };
  if (state.dimming !== undefined) params.dimming = state.dimming;

  if (state.sceneId !== undefined && state.sceneId > 0) {
    params.sceneId = state.sceneId;
    if (state.speed !== undefined) params.speed = state.speed;
    return params;
  }
  if (state.temp !== undefined && state.temp > 0) {
    params.temp = state.temp;
    return params;
  }

  const channels = [state.r, state.g, state.b, state.c, state.w];
  if (channels.some((v) => v !== undefined && v > 0)) {
    params.r = state.r ?? 0;
    params.g = state.g ?? 0;
    params.b = state.b ?? 0;
    if (state.c !== undefined) params.c = state.c;
    if (state.w !== undefined) params.w = state.w;
  }
  return params;
}
