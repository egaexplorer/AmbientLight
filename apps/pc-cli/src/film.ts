import { FILM_LOOKS } from "@ambientlight/core";
import { type ChosenLook, lookForTitle } from "@ambientlight/node";
import type { CliFlags } from "./cli.js";

export {
  type ChosenLook,
  defaultCacheDir,
  findTitle,
  pickFilm,
  pickSeries,
  splitYear,
  type TitleInfo,
  type TitleKind,
} from "@ambientlight/node";

/** Turns --look, --film or --series into a look. `undefined` without any of them: plain sync. */
export async function chooseLook(
  flags: CliFlags,
  fetchFn: typeof fetch = fetch,
  cacheDir?: string,
): Promise<ChosenLook | undefined> {
  if (flags.look !== undefined) return { name: flags.look, look: FILM_LOOKS[flags.look] };
  const kind = flags.film !== undefined ? "film" : flags.series !== undefined ? "series" : undefined;
  if (!kind) return undefined;
  return lookForTitle(kind, (kind === "film" ? flags.film : flags.series) ?? "", fetchFn, cacheDir);
}

export function describeLook({ name, look, info }: ChosenLook): string {
  const lines = info ? [`Title:  ${info.title}`, `Genre:  ${info.genres}`, `Source: ${info.source} ${info.url}`] : [];
  lines.push(`Look:   ${name} (brightness up to ${look.maxDimming}%, white ${look.whiteTemp} K, hue leaning to ${look.hue}°)`);
  return lines.join("\n");
}
