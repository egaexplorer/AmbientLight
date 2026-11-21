import {
  discoverBulbs,
  pilotToRestoreParams,
  RECOMMENDED_MAX_FPS,
  type ScreenCapturer,
  type SetPilotParams,
  SyncEngine,
  type SyncOptions,
  WIZ_PORT,
  WizLight,
} from "@ambientlight/core";
import { CliError, type CliFlags } from "./cli.js";
import type { AppConfig } from "./config.js";
import { errorMessage, formatColor, StatusLine, swatch } from "./log.js";
import { broadcastAddresses } from "./network.js";
import { createNodeUdpSocket } from "./udp.js";

export const FIREWALL_HINT =
  "If you're on Windows, make sure Node.js is allowed through Windows Defender Firewall on Private networks,\n" +
  'that the PC and bulb are on the same Wi-Fi/subnet, and that "Allow local communication" is on in the WiZ app.';

function requireBulbs(config: AppConfig): void {
  if (config.bulbs.length === 0) {
    throw new CliError(
      'No bulb configured. Run "npm run discover", then pass --bulb <ip> or add it to ambientlight.config.json.',
    );
  }
}

function syncOptions(config: AppConfig): Partial<SyncOptions> {
  return {
    fps: config.fps,
    smoothing: config.smoothing,
    colorWeighting: config.colorWeighting,
    minChange: config.minChange,
    keepAliveMs: config.keepAliveMs,
    calibration: config.calibration,
  };
}

/**
 * Capture pulls in native modules (sharp) — load it only for commands that capture,
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

function waitForShutdown(): Promise<string> {
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

export async function runSync(config: AppConfig, options: { once: boolean; verbose: boolean }): Promise<number> {
  requireBulbs(config);
  const { DesktopCapturer } = await loadCapture();
  const socket = await createNodeUdpSocket();
  const lights = config.bulbs.map((ip) => new WizLight(ip, socket));
  const capturer: ScreenCapturer = new DesktopCapturer({
    screen: config.screen,
    width: config.sampleWidth,
    height: config.sampleHeight,
  });

  try {
    if (options.once) {
      // Phase 1: one frame, no smoothing.
      const engine = new SyncEngine(capturer, lights, { ...syncOptions(config), smoothing: 1 });
      const report = await engine.tick();
      const rgb = (c: { r: number; g: number; b: number }): string =>
        `${swatch(c)}rgb(${c.r.toFixed(0)}, ${c.g.toFixed(0)}, ${c.b.toFixed(0)})`;
      console.log(`Screen average ${rgb(report.average)}  color weighted toward vivid areas ${rgb(report.color)}`);
      console.log(`Sent ${swatch(report.output)}${formatColor(report.output)} to ${config.bulbs.join(", ")} (capture ${report.captureMs.toFixed(0)} ms)`);
      return 0;
    }

    // Phase 2: continuous sync.
    if (config.fps > RECOMMENDED_MAX_FPS) {
      console.warn(`Warning: ${config.fps} FPS is above what WiZ bulbs handle well (~${RECOMMENDED_MAX_FPS}); expect lag or dropped updates.`);
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

    const status = new StatusLine(options.verbose);
    const engine = new SyncEngine(capturer, lights, syncOptions(config), {
      onFrame: (report) => status.update(report),
      onError: (error) => status.error(error),
    });

    const display = config.screen === undefined ? "primary display" : `display ${String(config.screen)}`;
    console.log(`Syncing ${display} -> ${config.bulbs.join(", ")} at ${engine.options.fps} FPS. Press Ctrl+C to stop.`);
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
