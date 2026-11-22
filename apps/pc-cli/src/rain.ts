import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  assessRain,
  clockTime,
  pilotToRestoreParams,
  type RainLevel,
  type SetPilotParams,
  type WeatherSnapshot,
  WizLight,
} from "@ambientlight/core";
import { type Advice, createAdvisor } from "./advisor.js";
import { CliError, type CliFlags, type SimulatedWeather } from "./cli.js";
import { requireBulbs, waitForShutdown } from "./commands.js";
import type { AppConfig } from "./config.js";
import { errorMessage, swatch } from "./log.js";
import { createNodeUdpSocket } from "./udp.js";
import { WeatherClient } from "./weather.js";

const POLL_MS = 120_000;
const MINUTE = 60_000;
const DEFAULT_PLAN = "Mau pulang sekarang.";

// The command talks Indonesian, like BMKG's data and the AI's advice.
const SIGNALS: Readonly<Record<RainLevel, { r: number; g: number; b: number; label: string; advice: string }>> = {
  go: { r: 0, g: 255, b: 0, label: "HIJAU", advice: "Boleh pulang sekarang." },
  prepare: { r: 255, g: 190, b: 0, label: "KUNING", advice: "Bawa jas hujan atau payung." },
  wait: { r: 0, g: 60, b: 255, label: "BIRU", advice: "Kemungkinan hujan, tunggu dulu." },
  danger: { r: 255, g: 0, b: 0, label: "MERAH", advice: "Hujan lebat atau petir, jangan berangkat dulu." },
  unknown: { r: 200, g: 0, b: 255, label: "UNGU", advice: "Data tidak lengkap, cek cuaca sendiri dulu." },
};

export function signalParams(level: RainLevel): SetPilotParams {
  const { r, g, b } = SIGNALS[level];
  // c and w are explicit, or white from the previous state lingers.
  return { state: true, r, g, b, c: 0, w: 0, dimming: 100 };
}

/** Made-up inputs for a demo. They go through the same rules and AI as live data. */
export function simulatedWeather(kind: SimulatedWeather, now: number): WeatherSnapshot {
  const wet = kind === "wait" || kind === "danger";
  return {
    point: [0, 0],
    utcOffsetMinutes: 420,
    alerts:
      kind === "danger"
        ? [{ effective: now - 10 * MINUTE, expires: now + 50 * MINUTE, polygons: [[[-1, -1], [-1, 1], [1, 1], [1, -1]]] }]
        : [],
    forecast:
      kind === "unknown"
        ? undefined
        : {
            issued: now - 60 * MINUTE,
            slots: [
              {
                time: now + 30 * MINUTE,
                code: wet ? 63 : kind === "prepare" ? 61 : 3,
                description: wet ? "Hujan Sedang" : kind === "prepare" ? "Hujan Ringan" : "Berawan",
                rainMm: wet ? 4 : kind === "prepare" ? 1 : 0,
              },
            ],
          },
    observation: { time: now - 5 * MINUTE, km: 10, weather: kind === "wait" ? "RA" : kind === "danger" ? "+TSRA" : "" },
  };
}

export async function runRain(config: AppConfig, flags: CliFlags, envDir: string): Promise<number> {
  requireBulbs(config);
  const { simulate } = flags;
  if (!simulate && !config.weatherArea) {
    throw new CliError(
      'Set "weatherArea" in ambientlight.config.json to a BMKG village code like "31.71.03.1001", or use --simulate.',
    );
  }
  const envFile = path.join(envDir, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const advisor = createAdvisor(process.env);
  const client = simulate ? undefined : new WeatherClient(config.weatherArea!);
  const plan = flags.plan?.slice(0, 300) ?? DEFAULT_PLAN;

  const socket = await createNodeUdpSocket();
  try {
    const lights = config.bulbs.map((ip) => new WizLight(ip, socket));
    const saved: Array<{ light: WizLight; params: SetPilotParams }> = [];
    if (config.restoreOnExit) {
      await Promise.all(
        lights.map(async (light) => {
          try {
            saved.push({ light, params: pilotToRestoreParams(await light.getPilot()) });
          } catch (error) {
            console.warn(`Lampu ${light.host} tidak akan dipulihkan saat keluar (${errorMessage(error)}).`);
          }
        }),
      );
    }

    console.log(simulate ? `*** SIMULASI "${simulate}": data contoh, bukan cuaca sekarang ***` : "Cuaca langsung, diperiksa tiap 2 menit.");
    console.log("Sumber: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika) dan NOAA Aviation Weather Center (METAR).");
    console.log(`AI: ${advisor?.name ?? "belum ada API key, hanya aturan"}`);
    console.log(`Rencana: ${plan}\nCtrl+C untuk berhenti.\n`);

    const stop = new AbortController();
    const shutdown = waitForShutdown().then(() => stop.abort());
    let shown: RainLevel | undefined;
    const send = (): void => {
      const level = shown;
      if (level === undefined || stop.signal.aborted) return;
      for (const light of lights) {
        light.setPilot(signalParams(level)).catch((error: unknown) => console.error(`Lampu: ${errorMessage(error)}`));
      }
    };
    const keepAlive = setInterval(send, config.keepAliveMs);

    const startedAt = Date.now();
    const fixed = simulate ? simulatedWeather(simulate, startedAt) : undefined;
    let last: { key: string; advice?: Advice | undefined } | undefined;

    const update = async (): Promise<void> => {
      const { snapshot, errors } = fixed ? { snapshot: fixed, errors: [] } : await client!.read(stop.signal);
      if (stop.signal.aborted) return;
      const now = fixed ? startedAt : Date.now();
      const rules = assessRain(snapshot, now);
      const clock = clockTime(now, snapshot.utcOffsetMinutes);
      const key = JSON.stringify(rules);
      const wantsAi = advisor !== undefined && rules.level !== "unknown";
      // Ask again only when the facts change or the last call failed: free quotas are small.
      if (last?.key === key && (!wantsAi || last.advice)) return;

      const tag = simulate ? " [SIMULASI]" : "";
      console.log(`${clock}${tag} aturan: ${swatch(SIGNALS[rules.level])}${SIGNALS[rules.level].label}`);
      for (const fact of rules.facts) console.log(`  - ${fact}`);
      for (const error of errors) console.log(`  ! ${error}`);
      // The rules set the light at once, so a slow or broken AI can't delay a warning.
      shown = rules.level;
      send();

      let advice: Advice | undefined;
      if (wantsAi) {
        try {
          advice = await advisor.advise(rules, plan, clock, stop.signal);
        } catch (error) {
          if (stop.signal.aborted) return;
          console.log(`  ! AI gagal, memakai aturan: ${errorMessage(error)}`);
        }
      }
      last = { key, advice };
      shown = advice?.level ?? rules.level;
      send();
      const signal = SIGNALS[shown];
      console.log(`=> ${swatch(signal)}${signal.label}: ${advice?.text ?? signal.advice} (${advice ? "AI" : "aturan"})\n`);
    };

    while (!stop.signal.aborted) {
      try {
        await update();
      } catch (error) {
        shown = "unknown";
        last = undefined;
        send();
        console.error(`Gagal memperbarui: ${errorMessage(error)}`);
      }
      await delay(POLL_MS, undefined, { signal: stop.signal }).catch(() => undefined); // rejects only on Ctrl+C
    }

    await shutdown;
    clearInterval(keepAlive);
    if (saved.length > 0) {
      await Promise.allSettled(saved.map(({ light, params }) => light.setPilot(params)));
      console.log("Warna lampu sebelumnya dipulihkan.");
    }
    return 0;
  } finally {
    await socket.close();
  }
}
