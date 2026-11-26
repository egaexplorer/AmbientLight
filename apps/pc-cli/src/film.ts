import { CALM_SMOOTHING, FAST_SMOOTHING, FILM_LOOKS, GAME_LOOKS, type GamePace, tuningWords } from "@ambientlight/core";
import { type ChosenLook, type LookTuner, lookForTitle } from "@ambientlight/node";
import type { CliFlags } from "./cli.js";

export {
  type ChosenLook,
  defaultCacheDir,
  findTitle,
  pickFilm,
  pickGame,
  pickSeries,
  splitYear,
  type TitleInfo,
  type TitleKind,
} from "@ambientlight/node";

/** A look as the CLI shows it: `aiOff` says why a title's look wasn't sent to an AI at all. */
export type CliLook = ChosenLook & { aiOff?: string };

/**
 * Turns --look, --game-look, --film, --series or --game into a look. `undefined` without any of them: plain sync.
 * A title's look is tuned by `tuner` unless --no-ai is set.
 */
export async function chooseLook(
  flags: CliFlags,
  fetchFn: typeof fetch = fetch,
  cacheDir?: string,
  tuner?: LookTuner,
): Promise<CliLook | undefined> {
  if (flags.look !== undefined) return { set: "film", name: flags.look, look: FILM_LOOKS[flags.look] };
  if (flags.gameLook !== undefined) return { set: "game", name: flags.gameLook, look: GAME_LOOKS[flags.gameLook] };
  const [kind, title] =
    flags.film !== undefined
      ? (["film", flags.film] as const)
      : flags.series !== undefined
        ? (["series", flags.series] as const)
        : flags.game !== undefined
          ? (["game", flags.game] as const)
          : [];
  if (kind === undefined) return undefined;
  const useTuner = flags.noAi ? undefined : tuner;
  const chosen: CliLook = await lookForTitle(kind, title, fetchFn, cacheDir, useTuner);
  if (!useTuner) chosen.aiOff = flags.noAi ? "--no-ai" : "no GEMINI_API_KEY or GROQ_API_KEY in .env";
  return chosen;
}

const PACE_TEXT: Record<GamePace, string> = {
  fast: `fast: smoothing at least ${FAST_SMOOTHING}`,
  normal: "normal: your smoothing",
  calm: `calm: smoothing at most ${CALM_SMOOTHING}`,
};

/** The AI's part, or `undefined` for a look picked by hand. */
function aiText(chosen: CliLook): string | undefined {
  if (chosen.tuning) {
    const changes = tuningWords(chosen.tuning).join(", ") || "no change";
    return `${chosen.tuning.by}: ${changes}. "${chosen.tuning.reason}"`;
  }
  if (chosen.aiError) return `not used, genre look kept (${chosen.aiError})`;
  if (chosen.aiOff) return `off (${chosen.aiOff})`;
  return undefined;
}

export function describeLook(chosen: CliLook): string {
  const { name, look, info } = chosen;
  const lines = info ? [`Title:  ${info.title}`, `Genre:  ${info.genres}`, `Source: ${info.source} ${info.url}`] : [];
  const ai = aiText(chosen);
  if (ai) lines.push(`AI:     ${ai}`);
  const kind = `${chosen.set === "game" ? "game look" : "look"}${chosen.tuning ? ", tuned by AI" : ""}`;
  const pace = chosen.set === "game" ? `, ${PACE_TEXT[chosen.look.pace]}` : "";
  lines.push(`Look:   ${name} ${kind} (brightness up to ${look.maxDimming}%, white ${look.whiteTemp} K, hue leaning to ${look.hue}°${pace})`);
  return lines.join("\n");
}
