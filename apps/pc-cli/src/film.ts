import { CALM_SMOOTHING, FAST_SMOOTHING, FILM_LOOKS, GAME_LOOKS, type GamePace } from "@ambientlight/core";
import { type ChosenLook, lookForTitle } from "@ambientlight/node";
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

/** Turns --look, --game-look, --film, --series or --game into a look. `undefined` without any of them: plain sync. */
export async function chooseLook(
  flags: CliFlags,
  fetchFn: typeof fetch = fetch,
  cacheDir?: string,
): Promise<ChosenLook | undefined> {
  if (flags.look !== undefined) return { set: "film", name: flags.look, look: FILM_LOOKS[flags.look] };
  if (flags.gameLook !== undefined) return { set: "game", name: flags.gameLook, look: GAME_LOOKS[flags.gameLook] };
  if (flags.film !== undefined) return lookForTitle("film", flags.film, fetchFn, cacheDir);
  if (flags.series !== undefined) return lookForTitle("series", flags.series, fetchFn, cacheDir);
  if (flags.game !== undefined) return lookForTitle("game", flags.game, fetchFn, cacheDir);
  return undefined;
}

const PACE_TEXT: Record<GamePace, string> = {
  fast: `fast: smoothing at least ${FAST_SMOOTHING}`,
  normal: "normal: your smoothing",
  calm: `calm: smoothing at most ${CALM_SMOOTHING}`,
};

export function describeLook(chosen: ChosenLook): string {
  const { name, look, info } = chosen;
  const lines = info ? [`Title:  ${info.title}`, `Genre:  ${info.genres}`, `Source: ${info.source} ${info.url}`] : [];
  const kind = chosen.set === "game" ? "game look" : "look";
  const pace = chosen.set === "game" ? `, ${PACE_TEXT[chosen.look.pace]}` : "";
  lines.push(`Look:   ${name} ${kind} (brightness up to ${look.maxDimming}%, white ${look.whiteTemp} K, hue leaning to ${look.hue}°${pace})`);
  return lines.join("\n");
}
