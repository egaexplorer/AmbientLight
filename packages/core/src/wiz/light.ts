import type { WizColor } from "../color/types.js";
import { clearTimer, setTimer, type TimerHandle } from "../platform/timers.js";
import type { ColorSink } from "../sync/types.js";
import { WIZ_PORT } from "./constants.js";
import type { ModelConfig, SystemConfig } from "./device.js";
import {
  encodeMessage,
  type PilotState,
  parseResponse,
  setPilotMessage,
  type SetPilotParams,
  type WizResponse,
} from "./protocol.js";
import type { UdpSocket } from "./socket.js";

export interface WizLightOptions {
  port?: number;
  /** How long to wait for a reply to a request (`getPilot`, `getSystemConfig`, ...). Default 1000 ms. */
  requestTimeoutMs?: number;
  /**
   * Send a request a second time if no reply arrived after this long. Wi-Fi bulbs drop packets, so one
   * retransmit turns most lost requests into a short delay instead of a timeout. 0 disables it. Default 400 ms.
   */
  retransmitAfterMs?: number;
}

export interface WizRequestOptions {
  /** Overrides `requestTimeoutMs` for this request. */
  timeoutMs?: number;
  /** Overrides `retransmitAfterMs` for this request. */
  retransmitAfterMs?: number;
}

export class WizTimeoutError extends Error {
  constructor(host: string, method: string, ms: number) {
    super(`No ${method} reply from ${host} within ${ms} ms`);
    this.name = "WizTimeoutError";
  }
}

/** The bulb answered with an `error` object instead of a `result`. */
export class WizResponseError extends Error {
  readonly host: string;
  readonly method: string;
  readonly code: number;
  /** The full reply, e.g. to check `isSignedResponse`. */
  readonly response: WizResponse;

  constructor(host: string, response: WizResponse) {
    const code = Number(response.error?.code);
    const detail = String(response.error?.message ?? "unknown error");
    super(`${response.method} failed on ${host}: ${detail} (code ${code})`);
    this.name = "WizResponseError";
    this.host = host;
    this.method = response.method;
    this.code = code;
    this.response = response;
  }
}

function resultOf(host: string, response: WizResponse): Record<string, unknown> {
  if (response.error) throw new WizResponseError(host, response);
  return response.result ?? {};
}

/** One WiZ bulb, addressed by IP over a shared UDP socket. */
export class WizLight implements ColorSink {
  readonly host: string;
  private readonly socket: UdpSocket;
  private readonly port: number;
  private readonly requestTimeoutMs: number;
  private readonly retransmitAfterMs: number;

  constructor(host: string, socket: UdpSocket, options: WizLightOptions = {}) {
    this.host = host;
    this.socket = socket;
    this.port = options.port ?? WIZ_PORT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1000;
    this.retransmitAfterMs = options.retransmitAfterMs ?? 400;
  }

  /** Fire-and-forget `setPilot` (UDP; the bulb's acknowledgement is not awaited). */
  setPilot(params: SetPilotParams): Promise<void> {
    return this.socket.send(setPilotMessage(params), this.port, this.host);
  }

  /**
   * `setPilot` that waits for the bulb's acknowledgement. Rejects with `WizResponseError` when the bulb
   * refuses the command (e.g. `-32602` on firmware that requires signed commands) and with
   * `WizTimeoutError` when no acknowledgement arrives. Too slow for the sync loop; use it for one-off commands.
   */
  async setPilotConfirmed(params: SetPilotParams, options: WizRequestOptions = {}): Promise<void> {
    resultOf(this.host, await this.exchange("setPilot", setPilotMessage(params), options));
  }

  /** Sends a calibrated color: RGB, or the white LEDs at `temp` when the color is in white mode. */
  setColor(color: WizColor): Promise<void> {
    if (color.temp !== undefined) return this.setPilot({ temp: color.temp, dimming: color.dimming });
    return this.setPilot({ r: color.r, g: color.g, b: color.b, dimming: color.dimming });
  }

  turnOff(): Promise<void> {
    return this.setPilot({ state: false });
  }

  /**
   * Sends `{"method", "params"}` and resolves with the bulb's reply, whether it carries `result` or
   * `error`. Replies have no request id, so they are matched by the bulb's IP and the method name.
   * Requires inbound UDP to reach this device (on Windows, allow Node.js through the firewall on
   * private networks).
   */
  request(method: string, params: object = {}, options: WizRequestOptions = {}): Promise<WizResponse> {
    return this.exchange(method, encodeMessage(method, params), options);
  }

  /** Reads the bulb's current state. */
  async getPilot(options: WizRequestOptions = {}): Promise<PilotState> {
    return resultOf(this.host, await this.request("getPilot", {}, options)) as PilotState;
  }

  /** Reads the hardware module name, firmware version and MAC address. */
  async getSystemConfig(options: WizRequestOptions = {}): Promise<SystemConfig> {
    return resultOf(this.host, await this.request("getSystemConfig", {}, options)) as SystemConfig;
  }

  /** Reads model limits such as `minDimLevel`. Older firmware answers `-32601` (method not found). */
  async getModelConfig(options: WizRequestOptions = {}): Promise<ModelConfig> {
    return resultOf(this.host, await this.request("getModelConfig", {}, options)) as ModelConfig;
  }

  private exchange(method: string, message: string, options: WizRequestOptions): Promise<WizResponse> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const retransmitAfterMs = options.retransmitAfterMs ?? this.retransmitAfterMs;

    return new Promise<WizResponse>((resolve, reject) => {
      let settled = false;
      let retransmit: TimerHandle | undefined;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        if (retransmit !== undefined) clearTimer(retransmit);
        unsubscribe();
        fn();
      };
      const send = (): Promise<void> => this.socket.send(message, this.port, this.host);

      const timer = setTimer(() => finish(() => reject(new WizTimeoutError(this.host, method, timeoutMs))), timeoutMs);
      if (retransmitAfterMs > 0 && retransmitAfterMs < timeoutMs) {
        // A lost retransmit is harmless: the timeout still reports the failure.
        retransmit = setTimer(() => void send().catch(() => undefined), retransmitAfterMs);
      }
      const unsubscribe = this.socket.onMessage((text, remote) => {
        if (remote.address !== this.host) return;
        const response = parseResponse(text);
        if (!response || response.method !== method) return;
        finish(() => resolve(response));
      });

      send().catch((error: unknown) => finish(() => reject(error)));
    });
  }
}
