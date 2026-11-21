import { type Clock, sleep, systemClock } from "../platform/timers.js";
import { WIZ_MIN_DIMMING } from "./constants.js";
import { type BulbKind, bulbKindFromModule, type ModelConfig, type SystemConfig } from "./device.js";
import { WizResponseError, type WizLight } from "./light.js";
import {
  isSignedResponse,
  type PilotState,
  pilotToRestoreParams,
  type SetPilotParams,
  WIZ_ERROR_INVALID_PARAMS,
  WIZ_ERROR_SECURITY,
} from "./protocol.js";

export interface BulbCheckOptions {
  /** Color shown during the test. Default: red at 100 %. */
  testColor?: SetPilotParams;
  /** How long the test color stays on before the previous state is restored. Default 1500 ms. */
  holdMs?: number;
  /** Put the bulb back the way it was after the test. Default true. */
  restore?: boolean;
  clock?: Clock;
}

/**
 * - `ready`: the bulb accepted the test color; AmbientLight can drive it.
 * - `white-only`: works, but the bulb has no RGB LEDs, so it can't follow screen colors.
 * - `needs-signing`: newer firmware that ignores unsigned `setPilot` (not supported yet).
 * - `rejected`: the bulb refused the test color for another reason.
 * - `no-ack`: the bulb answered reads but not the test color (probably a lost packet).
 * - `unreachable`: no reply to `getPilot` at all.
 */
export type BulbVerdict = "ready" | "white-only" | "needs-signing" | "rejected" | "no-ack" | "unreachable";

export type TestColorResult =
  | { status: "accepted" }
  | { status: "rejected"; code: number; message: string }
  | { status: "no-reply"; message: string }
  | { status: "skipped" };

export type RestoreResult = "restored" | "unconfirmed" | "not-needed" | "skipped";

export interface BulbCheckReport {
  host: string;
  verdict: BulbVerdict;
  /** Why `getPilot` failed, when the bulb is unreachable. */
  error?: string;
  /** Round trip of the first `getPilot`, in ms. */
  replyMs?: number;
  state?: PilotState;
  /** Replies carry an `hmac`: newer firmware that requires signed commands. */
  signed: boolean;
  system?: SystemConfig;
  systemError?: string;
  kind: BulbKind;
  model?: ModelConfig;
  modelError?: string;
  /** Lowest dimming the bulb accepts (`getModelConfig.minDimLevel`, else 10). */
  minDimming: number;
  testColor: SetPilotParams;
  test: TestColorResult;
  restore: RestoreResult;
}

export const DEFAULT_TEST_COLOR: Readonly<SetPilotParams> = Object.freeze({ state: true, r: 255, g: 0, b: 0, dimming: 100 });

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Diagnoses one bulb: reachability and signal (`getPilot`), model and firmware (`getSystemConfig`),
 * limits (`getModelConfig`), and whether it accepts an unsigned `setPilot`, by briefly showing a test
 * color and waiting for the acknowledgement. The previous state is restored afterwards.
 */
export async function checkBulb(light: WizLight, options: BulbCheckOptions = {}): Promise<BulbCheckReport> {
  const clock = options.clock ?? systemClock;
  const testColor = { ...DEFAULT_TEST_COLOR, ...options.testColor };
  const report: BulbCheckReport = {
    host: light.host,
    verdict: "unreachable",
    signed: false,
    kind: "unknown",
    minDimming: WIZ_MIN_DIMMING,
    testColor,
    test: { status: "skipped" },
    restore: "skipped",
  };

  // 1. Reachability. Everything else needs replies, so stop here if there are none.
  const startedAt = clock.now();
  try {
    const reply = await light.request("getPilot");
    report.replyMs = clock.now() - startedAt;
    report.signed = isSignedResponse(reply);
    if (reply.error) throw new WizResponseError(light.host, reply);
    report.state = (reply.result ?? {}) as PilotState;
  } catch (error) {
    report.error = message(error);
    return report;
  }

  // 2. Identity and limits. Optional: older firmware may not answer every method.
  try {
    report.system = await light.getSystemConfig();
    report.kind = bulbKindFromModule(report.system.moduleName);
  } catch (error) {
    report.systemError = message(error);
  }
  try {
    report.model = await light.getModelConfig();
    if (typeof report.model.minDimLevel === "number") report.minDimming = report.model.minDimLevel;
  } catch (error) {
    report.modelError = message(error);
  }

  // 3. Does the bulb accept an unsigned setPilot? Show the test color and wait for the acknowledgement.
  try {
    await light.setPilotConfirmed(testColor);
    report.test = { status: "accepted" };
  } catch (error) {
    report.test =
      error instanceof WizResponseError
        ? { status: "rejected", code: error.code, message: String(error.response.error?.message ?? "") }
        : { status: "no-reply", message: message(error) };
  }

  // 4. Put the bulb back. A rejected command changed nothing, so there is nothing to restore.
  if (report.test.status === "rejected") {
    report.restore = "not-needed";
  } else if (options.restore !== false) {
    await sleep(options.holdMs ?? 1500);
    try {
      await light.setPilotConfirmed(pilotToRestoreParams(report.state));
      report.restore = "restored";
    } catch {
      report.restore = "unconfirmed";
    }
  }

  report.verdict = verdictFor(report);
  return report;
}

function verdictFor(report: BulbCheckReport): BulbVerdict {
  switch (report.test.status) {
    case "accepted":
      return report.kind === "tunable-white" || report.kind === "dimmable-white" ? "white-only" : "ready";
    case "rejected":
      if (report.test.code === WIZ_ERROR_SECURITY) return "needs-signing";
      if (report.test.code === WIZ_ERROR_INVALID_PARAMS && report.signed) return "needs-signing";
      return "rejected";
    case "no-reply":
      return "no-ack";
    case "skipped":
      return "unreachable";
  }
}
