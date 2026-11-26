import type { RainAssessment, RainLevel } from "@ambientlight/core";
import { createAiClient } from "@ambientlight/node";

/** What the AI may pick for each rule result. It can never clear rain, or touch danger or missing data. */
export const ALLOWED: Readonly<Record<RainLevel, readonly RainLevel[]>> = {
  go: ["go", "prepare"],
  prepare: ["prepare", "wait"],
  wait: ["prepare", "wait"],
  danger: ["danger"],
  unknown: [],
};

const SYSTEM = `Kamu membantu seseorang memutuskan kapan pulang, berdasarkan fakta cuaca yang sudah diperiksa program.
Pilih "level" hanya dari pilihan yang diberikan:
- go: pulang sekarang
- prepare: pulang dengan jas hujan atau payung, atau pulang lebih cepat
- wait: tunggu dulu
- danger: jangan berangkat, hujan lebat atau petir
Timbang rencana orang itu: kendaraan, dan berapa lama ia bisa menunggu.
Tulis "advice": satu kalimat bahasa Indonesia santai, paling banyak 20 kata, sesuai level itu.
Jangan menambah fakta. Jam hanya boleh disalin dari masukan, format HH:MM. Jangan menjamin tidak akan hujan.`;

export interface Advice {
  level: RainLevel;
  text: string;
}

export interface Advisor {
  name: string;
  advise(rules: RainAssessment, plan: string, now: string, stop: AbortSignal): Promise<Advice>;
}

function timesIn(text: string): string[] {
  return [...text.matchAll(/\b(\d{1,2})[:.](\d\d)\b/g)].map((match) => `${match[1]!.padStart(2, "0")}:${match[2]}`);
}

/** Rejects anything the rules don't allow, and times that weren't in the input. */
export function checkAdvice(content: string, rules: RainAssessment, plan: string, now: string): Advice {
  const { level, advice } = JSON.parse(content) as { level?: RainLevel; advice?: unknown };
  if (level === undefined || !ALLOWED[rules.level].includes(level)) throw new Error("AI picked a level the rules don't allow");
  if (typeof advice !== "string" || advice.trim() === "" || advice.length > 240) throw new Error("AI gave no usable advice");

  const known = new Set(timesIn([now, plan, ...rules.facts].join(" ")));
  // "sampai 19" in the plan allows "19:00" in the answer.
  for (const [hour] of plan.matchAll(/\b\d{1,2}\b/g)) known.add(`${hour.padStart(2, "0")}:00`);
  if (timesIn(advice).some((time) => !known.has(time))) throw new Error("AI mentioned a time that isn't in the data");

  return { level, text: advice.replace(/\p{Cc}/gu, " ").trim() };
}

/** Advice from the first AI provider whose key is set (`createAiClient`), or `undefined` without a key. */
export function createAdvisor(env: NodeJS.ProcessEnv, fetchFn: typeof fetch = fetch): Advisor | undefined {
  const client = createAiClient(env, fetchFn);
  if (!client) return undefined;

  return {
    name: client.name,
    async advise(rules, plan, now, stop) {
      const content = await client.chatJson({
        system: SYSTEM,
        // No coordinates or place names: free tiers may keep what they receive.
        user: JSON.stringify({ sekarang: now, rencana: plan, fakta: rules.facts, pilihan: ALLOWED[rules.level] }),
        schemaName: "rain_advice",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["level", "advice"],
          properties: { level: { type: "string", enum: ALLOWED[rules.level] }, advice: { type: "string" } },
        },
        signal: stop,
        timeoutMs: 15_000,
      });
      return checkAdvice(content, rules, plan, now);
    },
  };
}
