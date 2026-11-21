import type { WizColor } from "../color/types.js";
import { clearTimer, setTimer } from "../platform/timers.js";
import type { ColorSink } from "../sync/types.js";
import { WIZ_PORT } from "./constants.js";
import {
  getPilotMessage,
  type PilotState,
  parseResponse,
  setPilotMessage,
  type SetPilotParams,
} from "./protocol.js";
import type { UdpSocket } from "./socket.js";

export interface WizLightOptions {
  port?: number;
  /** How long to wait for a `getPilot` reply. Default 1000 ms. */
  requestTimeoutMs?: number;
}

export class WizTimeoutError extends Error {
  constructor(host: string, method: string, ms: number) {
    super(`No ${method} reply from ${host} within ${ms} ms`);
    this.name = "WizTimeoutError";
  }
}

/** One WiZ bulb, addressed by IP over a shared UDP socket. */
export class WizLight implements ColorSink {
  readonly host: string;
  private readonly socket: UdpSocket;
  private readonly port: number;
  private readonly requestTimeoutMs: number;

  constructor(host: string, socket: UdpSocket, options: WizLightOptions = {}) {
    this.host = host;
    this.socket = socket;
    this.port = options.port ?? WIZ_PORT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1000;
  }

  /** Fire-and-forget `setPilot` (UDP; the bulb's acknowledgement is not awaited). */
  setPilot(params: SetPilotParams): Promise<void> {
    return this.socket.send(setPilotMessage(params), this.port, this.host);
  }

  setColor(color: WizColor): Promise<void> {
    return this.setPilot({ r: color.r, g: color.g, b: color.b, dimming: color.dimming });
  }

  turnOff(): Promise<void> {
    return this.setPilot({ state: false });
  }

  /**
   * Reads the bulb's current state. Requires inbound UDP to reach this device
   * (on Windows, allow Node.js through the firewall on private networks).
   */
  getPilot(): Promise<PilotState> {
    return new Promise<PilotState>((resolve, reject) => {
      const ms = this.requestTimeoutMs;
      const finish = (fn: () => void): void => {
        clearTimer(timer);
        unsubscribe();
        fn();
      };
      const timer = setTimer(() => finish(() => reject(new WizTimeoutError(this.host, "getPilot", ms))), ms);
      const unsubscribe = this.socket.onMessage((text, remote) => {
        if (remote.address !== this.host) return;
        const response = parseResponse(text);
        if (!response || response.method !== "getPilot") return;
        if (response.error) {
          const error = new Error(`getPilot failed on ${this.host}: ${response.error.message}`);
          finish(() => reject(error));
        } else {
          finish(() => resolve((response.result ?? {}) as PilotState));
        }
      });

      this.socket.send(getPilotMessage(), this.port, this.host).catch((error: unknown) => {
        finish(() => reject(error));
      });
    });
  }
}
