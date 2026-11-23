import { FILM_LOOKS, LOOK_NAMES, type LookName } from "@ambientlight/core";

const LABELS: Record<LookName, string> = {
  horror: "Horror",
  thriller: "Thriller",
  romance: "Romance",
  animation: "Animation",
  comedy: "Comedy",
  scifi: "Sci-fi",
  action: "Action",
  drama: "Drama",
};

// The character of each look in a few words (README, "Film looks").
const CHARACTER: Record<LookName, string> = {
  horror: "pale, dim",
  thriller: "deep, dim",
  romance: "leans pink",
  animation: "vivid",
  comedy: "warm",
  scifi: "leans cyan",
  action: "leans red-orange",
  drama: "soft, natural",
};

export interface LookChip {
  name: LookName | null;
  label: string;
  detail: string;
}

export function lookLabel(name: LookName): string {
  return LABELS[name];
}

/** "No look" first, then every film look with its brightness cap, white and character. */
export function lookChips(): LookChip[] {
  return [
    { name: null, label: "No look", detail: "Plain screen sync" },
    ...LOOK_NAMES.map((name) => ({
      name,
      label: LABELS[name],
      detail: `Up to ${FILM_LOOKS[name].maxDimming} % · ${FILM_LOOKS[name].whiteTemp} K · ${CHARACTER[name]}`,
    })),
  ];
}
