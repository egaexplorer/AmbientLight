import {
  FILM_LOOKS,
  type FilmLook,
  GAME_LOOK_NAMES,
  GAME_LOOKS,
  type GameLookName,
  type GamePace,
  LOOK_NAMES,
  type LookName,
  tuneLook,
  tuningWords,
} from "@ambientlight/core";
import type { LookChoice, LookTuningView } from "../../../shared/api";

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

const GAME_LABELS: Record<GameLookName, string> = {
  horror: "Horror",
  racing: "Racing & sports",
  shooter: "Shooter & fighting",
  cozy: "Cozy",
  platformer: "Platformer",
  strategy: "Strategy & sim",
  adventure: "Adventure & RPG",
};

// A game look has the colors of the film look it's built on (README, "Game looks").
const GAME_CHARACTER: Record<GameLookName, string> = {
  horror: CHARACTER.horror,
  racing: CHARACTER.scifi,
  shooter: CHARACTER.action,
  cozy: CHARACTER.comedy,
  platformer: CHARACTER.animation,
  strategy: CHARACTER.drama,
  adventure: CHARACTER.action,
};

const PACE_LABELS: Record<GamePace, string> = { fast: "Fast", normal: "Normal", calm: "Calm" };

export interface LookChip {
  /** The look a click picks; null is plain sync. */
  look: LookChoice | null;
  label: string;
  detail: string;
}

/** The settings behind a chosen look, with the AI's tuning when it has one. */
export function lookOf(choice: LookChoice): FilmLook {
  const base = choice.set === "game" ? GAME_LOOKS[choice.name] : FILM_LOOKS[choice.name];
  return choice.tuning ? tuneLook(base, choice.tuning) : base;
}

/** What the AI changed, e.g. "Brighter, much warmer", or "No change" when it kept the genre look. */
export function tuningText(tuning: LookTuningView): string {
  const text = tuningWords(tuning).join(", ") || "no change";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lookLabel(choice: LookChoice): string {
  return choice.set === "game" ? GAME_LABELS[choice.name] : LABELS[choice.name];
}

/** Whether a chip shows the look in use (title details aside). */
export function sameLook(a: LookChoice | null, b: LookChoice | null): boolean {
  return a === null || b === null ? a === b : a.set === b.set && a.name === b.name;
}

const NO_LOOK: LookChip = { look: null, label: "No look", detail: "Plain screen sync" };

/** "No look" first, then every film look with its brightness cap, white and character. */
export function lookChips(): LookChip[] {
  return [
    NO_LOOK,
    ...LOOK_NAMES.map((name) => ({
      look: { set: "film", name } as const,
      label: LABELS[name],
      detail: `Up to ${FILM_LOOKS[name].maxDimming} % · ${FILM_LOOKS[name].whiteTemp} K · ${CHARACTER[name]}`,
    })),
  ];
}

/** "No look" first, then every game look with its pace, brightness cap and character. */
export function gameLookChips(): LookChip[] {
  return [
    NO_LOOK,
    ...GAME_LOOK_NAMES.map((name) => ({
      look: { set: "game", name } as const,
      label: GAME_LABELS[name],
      detail: `${PACE_LABELS[GAME_LOOKS[name].pace]} · up to ${GAME_LOOKS[name].maxDimming} % · ${GAME_CHARACTER[name]}`,
    })),
  ];
}
