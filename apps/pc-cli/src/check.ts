import {
  BULB_KIND_LABELS,
  type BulbCheckReport,
  checkBulb,
  discoverBulbs,
  type PilotState,
  type SetPilotParams,
  WIZ_PORT,
  WizLight,
} from "@ambientlight/core";
import type { CliFlags } from "./cli.js";
import { FIREWALL_HINT } from "./commands.js";
import type { AppConfig } from "./config.js";
import { swatch } from "./log.js";
import { broadcastAddresses } from "./network.js";
import { createNodeUdpSocket } from "./udp.js";

type Mark = "ok" | "FAIL" | "warn" | "info";

function row(mark: Mark, label: string, text: string): string {
  return `  ${`[${mark}]`.padEnd(7)}${label.padEnd(16)}${text}`;
}

function describeState(state: PilotState): string {
  const parts: string[] = [state.state === false ? "off" : "on"];
  if (state.sceneId !== undefined && state.sceneId > 0) parts.push(`scene ${state.sceneId}`);
  else if (state.temp !== undefined && state.temp > 0) parts.push(`white ${state.temp} K`);
  else if (state.r !== undefined || state.g !== undefined || state.b !== undefined) {
    parts.push(`rgb(${state.r ?? 0}, ${state.g ?? 0}, ${state.b ?? 0})`);
  }
  if (state.dimming !== undefined) parts.push(`${state.dimming} %`);
  return parts.join(", ");
}

function describeColor(params: SetPilotParams): string {
  return `rgb(${params.r ?? 0}, ${params.g ?? 0}, ${params.b ?? 0}) at ${params.dimming ?? 100} %`;
}

const VERDICTS: Readonly<Record<BulbCheckReport["verdict"], string>> = Object.freeze({
  ready: "Ready: AmbientLight can drive this bulb. Next: npm run once, then npm run sync.",
  "white-only": "Works, but this bulb only has white LEDs, so it can't follow screen colors.",
  "needs-signing":
    "This bulb requires signed commands, so it ignores AmbientLight's colors.\n" +
    '  Usually this is the "Only verified controls" option. To fix it: in the WiZ app, open Settings (top right),\n' +
    '  tap Security under Current home, keep local communication on and turn off "Only verified controls".\n' +
    "  Then run this check again. (AmbientLight can't sign commands yet; see docs/WIZ_PROTOCOL.md.)",
  rejected: "The bulb rejected the test color (see the code above).",
  "no-ack":
    "The bulb answers reads but didn't acknowledge the test color; a packet was probably lost.\n" +
    "  Run the check again. If the bulb did change color, it works.",
  unreachable: `No reply from the bulb.\n  ${FIREWALL_HINT.replace(/\n/g, "\n  ")}`,
});

/** Turns a check report into the lines printed by `check`. Exported for tests. */
export function formatCheckReport(report: BulbCheckReport): string[] {
  const lines: string[] = [];
  if (report.verdict === "unreachable") {
    lines.push(row("FAIL", "Reachable", report.error ?? "no reply"));
    lines.push(`  Result: ${VERDICTS.unreachable}`);
    return lines;
  }

  const signal = report.state?.rssi !== undefined ? `; signal ${report.state.rssi} dBm` : "";
  lines.push(row("ok", "Reachable", `replied in ${report.replyMs ?? "?"} ms${signal}`));
  if (report.state) lines.push(row("info", "Current state", describeState(report.state)));

  if (report.system) {
    const module = report.system.moduleName ?? "not reported";
    const kindMark: Mark = report.kind === "color" ? "ok" : report.kind === "unknown" ? "info" : "warn";
    lines.push(row(kindMark, "Model", `${module} (${BULB_KIND_LABELS[report.kind]})`));
    lines.push(row("info", "Firmware", report.system.fwVersion ?? "not reported"));
    if (report.system.mac) lines.push(row("info", "MAC", report.system.mac));
  } else {
    lines.push(row("info", "Model", `not reported (${report.systemError ?? "no reply"})`));
  }

  lines.push(
    row(
      "info",
      "Min dimming",
      `${report.minDimming} %${report.model?.minDimLevel === undefined ? " (default; not reported by the bulb)" : ""}`,
    ),
  );
  lines.push(
    row(
      report.signed ? "warn" : "ok",
      "Signed replies",
      report.signed ? "yes (newer firmware, may require signed commands)" : "no",
    ),
  );

  const color = `${swatch({ r: report.testColor.r ?? 0, g: report.testColor.g ?? 0, b: report.testColor.b ?? 0 })}${describeColor(report.testColor)}`;
  switch (report.test.status) {
    case "accepted":
      lines.push(row("ok", "Test color", `accepted ${color}`));
      break;
    case "rejected":
      lines.push(row("FAIL", "Test color", `rejected: ${report.test.message || "error"} (code ${report.test.code})`));
      break;
    case "no-reply":
      lines.push(row("FAIL", "Test color", `sent ${color}, but no acknowledgement`));
      break;
    case "skipped":
      break;
  }

  switch (report.restore) {
    case "restored":
      lines.push(row("ok", "Restore", "previous state is back"));
      break;
    case "unconfirmed":
      lines.push(row("warn", "Restore", "sent, but not acknowledged; check that the bulb looks right"));
      break;
    case "not-needed":
      lines.push(row("info", "Restore", "not needed (the bulb didn't change)"));
      break;
    case "skipped":
      lines.push(row("info", "Restore", "skipped (--no-restore)"));
      break;
  }

  lines.push(`  Result: ${VERDICTS[report.verdict]}`);
  return lines;
}

export async function runCheck(config: AppConfig, flags: CliFlags): Promise<number> {
  const socket = await createNodeUdpSocket({ broadcast: true });
  try {
    let hosts = config.bulbs;
    if (hosts.length === 0) {
      const timeoutMs = flags.timeoutMs ?? 2000;
      console.log(`No bulb configured, so searching the network (UDP ${WIZ_PORT}) ...`);
      const found = await discoverBulbs(socket, { broadcastAddresses: broadcastAddresses(), timeoutMs });
      if (found.length === 0) {
        console.log(`\nNo bulbs answered within ${timeoutMs} ms.\n${FIREWALL_HINT}`);
        return 1;
      }
      hosts = found.map((bulb) => bulb.address);
      console.log(`Found ${hosts.join(", ")}.`);
    }

    const testColor: SetPilotParams = { state: true, ...(flags.rgb ?? { r: 255, g: 0, b: 0 }), dimming: flags.dimming ?? 100 };
    const restore = !flags.noRestore;
    let ready = 0;
    for (const host of hosts) {
      const showing = restore ? "for about 2 seconds, then goes back" : "and stays that way (--no-restore)";
      console.log(`\nChecking ${host}. If it answers, it shows ${describeColor(testColor)} ${showing}.`);
      const report = await checkBulb(new WizLight(host, socket), { testColor, restore });
      for (const line of formatCheckReport(report)) console.log(line);
      if (report.verdict === "ready") ready++;
    }

    if (ready > 0) {
      console.log(
        "\nTip: in the WiZ app, set firmware updates to manual, so an update can't switch a working bulb\n" +
          "to firmware that requires signed commands.",
      );
    }
    return ready === hosts.length ? 0 : 1;
  } finally {
    await socket.close();
  }
}
