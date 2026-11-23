import { sleep } from "../platform/timers.js";
import type { WizLight } from "./light.js";
import { pilotToRestoreParams, type SetPilotParams } from "./protocol.js";

export interface IdentifyOptions {
  /** How many times the bulb flashes. Default 2. */
  flashes?: number;
  /** How long each flash stays on, and the pause after it, in ms. Default 400 and 300. */
  onMs?: number;
  offMs?: number;
  /** What a flash shows. Default: cool white from the white LEDs at full brightness. */
  flash?: SetPilotParams;
}

export interface IdentifyResult {
  host: string;
  /** Whether the bulb acknowledged getting its previous state back. */
  restored: boolean;
}

export const DEFAULT_IDENTIFY_FLASH: Readonly<SetPilotParams> = Object.freeze({ state: true, temp: 6500, dimming: 100 });

/**
 * Flashes one bulb so the user can tell which one it is, then puts it back the way it was. Uses only the commands
 * `checkBulb` already relies on (`getPilot`, `setPilot`); throws if the bulb doesn't answer `getPilot`.
 */
export async function identifyBulb(light: WizLight, options: IdentifyOptions = {}): Promise<IdentifyResult> {
  const flashes = Math.max(1, Math.round(options.flashes ?? 2));
  const flash = { ...DEFAULT_IDENTIFY_FLASH, ...options.flash };
  const previous = await light.getPilot();

  for (let i = 0; i < flashes; i++) {
    await light.setPilot(flash);
    await sleep(options.onMs ?? 400);
    await light.setPilot({ state: false });
    await sleep(options.offMs ?? 300);
  }

  try {
    await light.setPilotConfirmed(pilotToRestoreParams(previous));
    return { host: light.host, restored: true };
  } catch {
    return { host: light.host, restored: false };
  }
}
