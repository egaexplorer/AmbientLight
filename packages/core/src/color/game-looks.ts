import { FILM_LOOKS, type FilmLook } from "./looks.js";

/** How quickly the light follows the screen. `fast` and `calm` only push the user's own setting their way. */
export type GamePace = "fast" | "normal" | "calm";

/** A film look's colors plus a pace: games differ less in mood than in how fast their screen changes. */
export interface GameLook extends FilmLook {
  pace: GamePace;
}

/**
 * `smoothing` at least this for fast games: 90 % of a change after ~77 ms instead of ~190 ms at the default 0.7. At
 * 20 FPS a one-frame muzzle flash still reaches the bulb at ~78 % and fades out, which flickers less than 1.0.
 */
export const FAST_SMOOTHING = 0.95;
/** `sceneCut` at most this for fast games (unmeasured), so big changes skip even the short fade. */
export const FAST_SCENE_CUT = 25;
/** `smoothing` at most this for calm games: 90 % of a change after ~450 ms, so menus and maps don't make the light twitch. */
export const CALM_SMOOTHING = 0.4;

// The colors are the film looks', so tuning a film look also tunes the game looks built on it.
export const GAME_LOOKS = {
  horror: { ...FILM_LOOKS.horror, pace: "normal" },
  racing: { ...FILM_LOOKS.scifi, pace: "fast" },
  shooter: { ...FILM_LOOKS.action, pace: "fast" },
  cozy: { ...FILM_LOOKS.comedy, pace: "calm" },
  platformer: { ...FILM_LOOKS.animation, pace: "normal" },
  strategy: { ...FILM_LOOKS.drama, pace: "calm" },
  adventure: { ...FILM_LOOKS.action, pace: "normal" },
} as const satisfies Record<string, GameLook>;

export type GameLookName = keyof typeof GAME_LOOKS;
export const GAME_LOOK_NAMES = Object.keys(GAME_LOOKS) as GameLookName[];

// The first match wins, so the order is the priority: a horror visual novel is horror, a racing simulator is racing,
// a puzzle platformer is cozy, and a tactical shooter is a shooter.
const GAME_GENRE_RULES: ReadonlyArray<readonly [RegExp, GameLookName]> = [
  [/\bhorror\b/i, "horror"],
  [/\b(racing|kart|driving|sports?|football|soccer|basketball|golf|tennis)\b/i, "racing"],
  [/\b(shooter|(?:shoot|beat)[- ]['’]?em[- ]up|battle royale|fighting|hack[- ]and[- ]slash)\b/i, "shooter"],
  [/\b(visual novel|dating sim(?:ulation)?|life sim(?:ulation)?|farm(?:ing)?|puzzle|casual|cozy|cosy|idle)\b/i, "cozy"],
  // Not "cross-platform" (where a game runs) or "third-party".
  [/(?<!(?:cross|multi|first|second|third)-)\b(platform(?:er|ing)?|metroidvania|party|rhythm)\b/i, "platformer"],
  [
    /\b(strategy|4X|tactics|tactical role-playing|city[- ]build(?:ing|er)|management|simulation|simulator|multiplayer online battle arena|MOBA|tower defen[cs]e|card)\b/i,
    "strategy",
  ],
  [/\b(role-playing|RPG|action-adventure|adventure|open[- ]world|MMO\w*|stealth|survival|sandbox|roguelike|roguelite|action)\b/i, "adventure"],
];

/** Picks a game look from genre words such as "2014 survival horror". `undefined` when none is known. */
export function gameLookForGenres(text: string): GameLookName | undefined {
  return GAME_GENRE_RULES.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * The user's response settings with a pace on top. Like a look's brightness cap, a pace only moves the setting its
 * way: `--smoothing 1` stays 1 under a fast look, and a `sceneCut` of 0 (off) stays off.
 */
export function applyPace(options: { smoothing: number; sceneCut: number }, pace: GamePace): { smoothing: number; sceneCut: number } {
  switch (pace) {
    case "fast":
      return { smoothing: Math.max(options.smoothing, FAST_SMOOTHING), sceneCut: Math.min(options.sceneCut, FAST_SCENE_CUT) };
    case "calm":
      return { smoothing: Math.min(options.smoothing, CALM_SMOOTHING), sceneCut: options.sceneCut };
    case "normal":
      return { ...options };
  }
}
