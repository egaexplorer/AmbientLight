import { setTimeout as delay } from "node:timers/promises";
import {
  applyLook,
  discoverBulbs,
  type PixelFrame,
  pilotToRestoreParams,
  RECOMMENDED_MAX_FPS,
  type ScreenCapturer,
  type SetPilotParams,
  SyncEngine,
  type SyncOptions,
  WIZ_PORT,
  WizLight,
  WizTimeoutError,
} from "@ambientlight/core";
import { CliError, type CliFlags } from "./cli.js";
import type { AppConfig } from "./config.js";
import { type ChosenLook, describeLook } from "./film.js";
import { saveFramePng } from "./frame-file.js";
import { GdiCapturer } from "./gdi-capture.js";
import { colorSwatch, errorMessage, formatColor, formatPilot, StatusLine, swatch } from "./log.js";
import { broadcastAddresses } from "./network.js";
import { createNodeUdpSocket } from "./udp.js";

export const FIREWALL_HINT =
  "If you're on Windows, make sure Node.js is allowed through Windows Defender Firewall on Private networks,\n" +
  'that the PC and bulb are on the same Wi-Fi/subnet, and that "Allow local communication" is on in the WiZ app.';

export function requireBulbs(config: AppConfig): void {
  if (config.bulbs.length === 0) {
    throw new CliError(
      'No bulb configured. Run "npm run discover", then pass --bulb <ip> or add it to ambientlight.config.json.',
    );
  }
}

function syncOptions(config: AppConfig, look?: ChosenLook): Partial<SyncOptions> {
  return {
    fps: config.fps,
    smoothing: config.smoothing,
    colorWeighting: config.colorWeighting,
    colorMode: config.colorMode,
    minChange: config.minChange,
    sceneCut: config.sceneCut,
    keepAliveMs: config.keepAliveMs,
    calibration: look ? applyLook(config.calibration, look.look) : config.calibration,
    hueTarget: look?.look.hue,
  };
}

/**
 * The screenshot-desktop backend pulls in native modules (sharp) — load it only for commands that use it,
 * so `discover` and `color` still work if the capture stack fails to install.
 */
async function loadCapture(): Promise<typeof import("./capture.js")> {
  try {
    return await import("./capture.js");
  } catch (error) {
    throw new CliError(
      `Screen capture is unavailable: ${errorMessage(error)}\nTry "npm install" again (sharp downloads a native binary for your platform).`,
    );
  }
}

async function createCapturer(config: AppConfig): Promise<ScreenCapturer> {
  const options = { screen: config.screen, width: config.sampleWidth, height: config.sampleHeight };
  if (config.capture === "gdi") {
    if (process.platform !== "win32") {
      throw new CliError('"capture": "gdi" only works on Windows. Use "screenshot-desktop" (--capture screenshot-desktop).');
    }
    return new GdiCapturer(options);
  }
  const { DesktopCapturer } = await loadCapture();
  return new DesktopCapturer(options);
}

export function waitForShutdown(): Promise<string> {
  const signals = ["SIGINT", "SIGTERM", "SIGBREAK"] as const;
  return new Promise((resolve) => {
    const handler = (signal: string): void => {
      for (const s of signals) process.off(s, handler);
      resolve(signal);
    };
    for (const s of signals) process.on(s, handler);
  });
}

export async function runDiscover(flags: CliFlags): Promise<number> {
  const addresses = broadcastAddresses();
  const timeoutMs = flags.timeoutMs ?? 2000;
  console.log(`Searching for WiZ bulbs (UDP ${WIZ_PORT}) via ${addresses.join(", ")} ...`);

  const socket = await createNodeUdpSocket({ broadcast: true });
  try {
    const bulbs = await discoverBulbs(socket, { broadcastAddresses: addresses, timeoutMs });
    if (bulbs.length === 0) {
      console.log(`\nNo bulbs answered within ${timeoutMs} ms.\n${FIREWALL_HINT}`);
      return 1;
    }
    console.log(`\nFound ${bulbs.length} bulb${bulbs.length === 1 ? "" : "s"}:\n`);
    for (const bulb of bulbs) {
      const s = bulb.state;
      const state = s.state === false ? "off" : "on";
      const rssi = bulb.rssi !== undefined ? `  rssi ${bulb.rssi} dBm` : "";
      console.log(`  ${bulb.address.padEnd(15)}  mac ${bulb.mac ?? "?"}  ${state}${rssi}`);
    }
    console.log('\nTip: reserve these IPs in your router (DHCP reservation) and put them in ambientlight.config.json "bulbs".');
    return 0;
  } finally {
    await socket.close();
  }
}

/** Prints each bulb's current state exactly as it reports it (`getPilot`). Sends no command. */
export async function runState(config: AppConfig): Promise<number> {
  requireBulbs(config);
  const socket = await createNodeUdpSocket();
  let failed = false;
  try {
    for (const ip of config.bulbs) {
      try {
        console.log(`${ip.padEnd(15)}  ${formatPilot(await new WizLight(ip, socket).getPilot())}`);
      } catch (error) {
        failed = true;
        console.log(`${ip.padEnd(15)}  ${errorMessage(error)}`);
      }
    }
  } finally {
    await socket.close();
  }
  if (failed) console.log(`\n${FIREWALL_HINT}`);
  return failed ? 1 : 0;
}

/**
 * Turns every configured bulb on or off and waits for each bulb's acknowledgement. Off is a software off: the
 * bulb's Wi-Fi stays on, so it still answers `state` and comes back with `on`.
 */
export async function runPower(config: AppConfig, on: boolean): Promise<number> {
  requireBulbs(config);
  const word = on ? "on" : "off";
  const socket = await createNodeUdpSocket();
  let failed = false;
  let noReply = false;
  try {
    for (const ip of config.bulbs) {
      try {
        await new WizLight(ip, socket).setPilotConfirmed({ state: on });
        console.log(`Turned ${word} ${ip}`);
      } catch (error) {
        failed = true;
        if (error instanceof WizTimeoutError) {
          noReply = true;
          console.log(`Sent "${word}" to ${ip}, but it didn't answer (it may still have worked): ${error.message}`);
        } else {
          console.log(`Couldn't turn ${word} ${ip}: ${errorMessage(error)}`);
        }
      }
    }
  } finally {
    await socket.close();
  }
  if (noReply) console.log(`
${FIREWALL_HINT}`);
  return failed ? 1 : 0;
}

export async function runDisplays(): Promise<number> {
  const { listDisplays } = await loadCapture();
  const displays = await listDisplays();
  if (displays.length === 0) {
    console.log("No displays reported.");
    return 1;
  }
  console.log("Displays (use the id with --screen or \"screen\" in the config):\n");
  for (const display of displays) {
    console.log(`  id: ${JSON.stringify(display.id)}  name: ${display.name}`);
  }
  return 0;
}

export async function runColor(config: AppConfig, flags: CliFlags): Promise<number> {
  requireBulbs(config);
  if (!flags.rgb) throw new CliError("The color command needs --rgb r,g,b (for example --rgb 255,0,0)");
  const params: SetPilotParams = { ...flags.rgb, dimming: flags.dimming ?? 100 };

  const socket = await createNodeUdpSocket();
  try {
    for (const ip of config.bulbs) {
      await new WizLight(ip, socket).setPilot(params);
      console.log(`Sent ${swatch(flags.rgb)}rgb(${params.r}, ${params.g}, ${params.b}) dim ${params.dimming}% to ${ip}`);
    }
  } finally {
    await socket.close();
  }
  return 0;
}

export async function runSync(
  config: AppConfig,
  options: { once: boolean; verbose: boolean; saveFrame?: string | undefined; look?: ChosenLook | undefined },
): Promise<number> {
  requireBulbs(config);
  if (options.look) console.log(describeLook(options.look));
  const capturer = await createCapturer(config);
  const socket = await createNodeUdpSocket();
  const lights = config.bulbs.map((ip) => new WizLight(ip, socket));

  try {
    if (options.once) {
      // Phase 1: one frame, no smoothing.
      let frame: PixelFrame | undefined;
      // Keeps the frame the engine analyzed for --save-frame, without skewing the capture time it reports.
      const recorder: ScreenCapturer = { capture: async () => (frame = await capturer.capture()) };
      const engine = new SyncEngine(recorder, lights, { ...syncOptions(config, options.look), smoothing: 1 });
      const report = await engine.tick();
      if (options.saveFrame !== undefined && frame) {
        console.log(`Saved the analyzed frame to ${await saveFramePng(frame, options.saveFrame)}`);
      }
      const rgb = (c: { r: number; g: number; b: number }): string =>
        `${swatch(c)}rgb(${c.r.toFixed(0)}, ${c.g.toFixed(0)}, ${c.b.toFixed(0)})`;
      const paleWhite = config.calibration.paleWhite;
      console.log(`Screen average ${rgb(report.average)}  hue source (${config.colorMode}) ${rgb(report.color)}`);
      console.log(
        `Sent ${colorSwatch(report.output, paleWhite)}${formatColor(report.output, paleWhite)} to ${config.bulbs.join(", ")} (capture ${report.captureMs.toFixed(0)} ms)`,
      );
      // Read the state back, so a difference between what was sent and what the bulb applied is visible.
      await delay(300);
      for (const light of lights) {
        try {
          console.log(`${light.host} reports ${formatPilot(await light.getPilot())}`);
        } catch (error) {
          console.log(`Couldn't read ${light.host} back: ${errorMessage(error)}`);
        }
      }
      return 0;
    }

    // Phase 2: continuous sync.
    if (config.fps > RECOMMENDED_MAX_FPS) {
      console.warn(`Warning: ${config.fps} FPS is above the ${RECOMMENDED_MAX_FPS} FPS measured to work on a WiZ bulb; expect lag or dropped updates.`);
    }

    const saved: Array<{ light: WizLight; params: SetPilotParams }> = [];
    if (config.restoreOnExit) {
      const states = await Promise.allSettled(lights.map((light) => light.getPilot()));
      states.forEach((result, i) => {
        const light = lights[i]!;
        if (result.status === "fulfilled") {
          saved.push({ light, params: pilotToRestoreParams(result.value) });
        } else {
          console.warn(`Note: couldn't read the current state of ${light.host}, so it won't be restored on exit (${errorMessage(result.reason)}).`);
        }
      });
    }

    const status = new StatusLine(options.verbose, config.calibration.paleWhite);
    const engine = new SyncEngine(capturer, lights, syncOptions(config, options.look), {
      onFrame: (report) => status.update(report),
      onError: (error) => status.error(error),
    });

    const display = config.screen === undefined ? "primary display" : `display ${String(config.screen)}`;
    console.log(
      `Syncing ${display} -> ${config.bulbs.join(", ")} at ${engine.options.fps} FPS (capture: ${config.capture}). Press Ctrl+C to stop.`,
    );
    engine.start();

    await waitForShutdown();
    status.end();
    console.log("Stopping...");
    await engine.stop();

    if (saved.length > 0) {
      await Promise.allSettled(saved.map(({ light, params }) => light.setPilot(params)));
      console.log(`Restored previous state of ${saved.map((s) => s.light.host).join(", ")}.`);
    }
    return 0;
  } finally {
    await capturer.close?.();
    await socket.close();
  }
}
