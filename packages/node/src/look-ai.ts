import {
  type FilmLook,
  type LookTuning,
  stepOf,
  TUNING_CONTROLS,
  TUNING_WORDS,
  type TuningStep,
} from "@ambientlight/core";
import { createAiClient } from "./ai.js";
import type { TitleKind } from "./film.js";

/** Bump when the prompt or the step sizes change, so cached tunings are asked again. */
export const TUNING_VERSION = 1;
/** The look waits for the answer before the light changes, so keep it short. */
const TIMEOUT_MS = 10_000;
const MAX_REASON = 200;

/** How an AI nudged one title's look, and why. */
export interface TitleTuning extends LookTuning {
  /** One English sentence: what in the summary led to the change. */
  reason: string;
  /** The model that answered, e.g. "Gemini (gemini-3.5-flash-lite)". */
  by: string;
}

export interface TuningRequest {
  kind: TitleKind;
  title: string;
  genres: string;
  /** From Wikipedia or TVmaze (CC BY-SA), so it may be sent to an AI service. */
  summary: string;
  lookName: string;
  look: FilmLook;
}

export interface LookTuner {
  /** e.g. "Gemini (gemini-3.5-flash-lite)". */
  name: string;
  tune(request: TuningRequest, signal?: AbortSignal): Promise<TitleTuning>;
}

const SYSTEM = `You fine-tune the light of a smart bulb that follows the colors on a screen while someone watches a film or series, or plays a game.
The program already chose a base look from the title's genre, and that look covers the genre. Change it only where this title's own story, setting or tone, as the summary describes it, differs from a typical title of that genre.
For each of brightness, warmth and vividness pick one of the allowed words. Pick "same" unless the summary clearly calls for a change, and "much" only for a strong reason.
- brightness: how bright the light gets (brighter for a lighter tone, comedy or daylight; dimmer for grim, dark or night-time stories)
- warmth: the color of white and gray scenes (warmer for cozy, nostalgic, romantic or rural; cooler for cold, clinical, eerie or futuristic)
- vividness: how strong colors get (more vivid for colorful, playful or fantastical; softer for muted, gritty or realistic)
The bulb's limits: brightness 10 to 100 %, white 2200 K (warmest) to 6500 K (coolest). A step past a limit does nothing.
Write "reason" first: one English sentence of at most 20 words naming what in the summary led to your choice. Use only facts from the summary.`;

const word = (values: readonly string[]) => ({ type: "string", enum: [...values] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  // The reason comes first, so the model decides after saying why.
  required: ["reason", ...TUNING_CONTROLS],
  properties: {
    reason: { type: "string" },
    brightness: word(TUNING_WORDS.brightness),
    warmth: word(TUNING_WORDS.warmth),
    vividness: word(TUNING_WORDS.vividness),
  },
};

/** External text ends up in the terminal and the app. */
function clean(text: string): string {
  return text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
}

/** Accepts only the allowed words and a short reason, whatever the schema promised. */
export function checkTuning(content: string): LookTuning & { reason: string } {
  let answer: unknown;
  try {
    // Some models wrap JSON in a Markdown fence even when asked for JSON.
    answer = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("AI didn't answer in JSON");
  }
  if (typeof answer !== "object" || answer === null) throw new Error("AI didn't answer with an object");
  const fields = answer as Record<string, unknown>;
  const tuning: Partial<Record<keyof LookTuning, TuningStep>> = {};
  for (const control of TUNING_CONTROLS) {
    const step = stepOf(control, fields[control]);
    if (step === undefined) throw new Error(`AI picked a ${control} that isn't allowed: ${clean(String(fields[control])).slice(0, 40)}`);
    tuning[control] = step;
  }
  const reason = typeof fields.reason === "string" ? clean(fields.reason) : "";
  if (reason === "" || reason.length > MAX_REASON) throw new Error("AI gave no usable reason");
  return { ...(tuning as LookTuning), reason };
}

/** A tuning read back from the cache, or `undefined` if it isn't one. */
export function asTitleTuning(value: unknown): TitleTuning | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const steps = TUNING_CONTROLS.every((control) => [-2, -1, 0, 1, 2].includes(fields[control] as number));
  if (!steps || typeof fields.reason !== "string" || typeof fields.by !== "string") return undefined;
  return {
    brightness: fields.brightness as TuningStep,
    warmth: fields.warmth as TuningStep,
    vividness: fields.vividness as TuningStep,
    reason: clean(fields.reason).slice(0, MAX_REASON),
    by: clean(fields.by).slice(0, 100),
  };
}

/** A tuner for the first AI provider whose key is in `env` (see `createAiClient`), or `undefined` without a key. */
export function createLookTuner(env: NodeJS.ProcessEnv, fetchFn: typeof fetch = fetch): LookTuner | undefined {
  const client = createAiClient(env, fetchFn);
  if (!client) return undefined;
  return {
    name: client.name,
    async tune({ kind, title, genres, summary, lookName, look }, signal) {
      const content = await client.chatJson({
        system: SYSTEM,
        // Only public facts about the title: nothing from the screen and nothing about the user.
        user: JSON.stringify({
          kind,
          title,
          genre: genres,
          base_look: {
            name: lookName,
            max_brightness_percent: look.maxDimming,
            white_kelvin: look.whiteTemp,
            saturation_factor: look.saturation,
          },
          summary,
        }),
        schemaName: "look_tuning",
        schema: SCHEMA,
        ...(signal ? { signal } : {}),
        timeoutMs: TIMEOUT_MS,
      });
      return { ...checkTuning(content), by: client.name };
    },
  };
}
