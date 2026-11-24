import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FILM_LOOKS,
  type FilmLook,
  GAME_LOOKS,
  type GameLook,
  type GameLookName,
  gameLookForGenres,
  type LookName,
  lookForGenres,
} from "@ambientlight/core";
import { errorMessage, UserError } from "./errors.js";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const TVMAZE_API = "https://api.tvmaze.com/search/shows";
// A descriptive name without anyone's contact details. Wikimedia allows such a client 10 requests a minute, which is
// why a lookup is a single request and is cached.
const USER_AGENT = "film-genre-lookup/0.1";
const TIMEOUT_MS = 15_000;

export type TitleKind = "film" | "series" | "game";

/** The CLI flag that picks a look by hand, for the advice in error messages. */
function lookFlag(kind: TitleKind): string {
  return kind === "game" ? "--game-look" : "--look";
}

/**
 * Why a title lookup failed, so each app can word its own advice (the messages name the CLI's flags):
 * `no-title` empty input, `offline` no connection, `rate-limited` (see `retryAfterS`), `http` another HTTP error,
 * `unreadable` not JSON, `refused` the API refused the search, `not-found` no exact match (see `similar`),
 * `no-genre` found, but no known genre in its description.
 */
export type TitleErrorCode = "no-title" | "offline" | "rate-limited" | "http" | "unreadable" | "refused" | "not-found" | "no-genre";

export class TitleError extends UserError {
  override name = "TitleError";
  readonly code: TitleErrorCode;
  /** Titles that came close (for `not-found`). */
  readonly similar: string[];
  /** Seconds to wait (for `rate-limited`). */
  readonly retryAfterS: number | undefined;

  constructor(code: TitleErrorCode, message: string, extra: { similar?: string[]; retryAfterS?: number } = {}) {
    super(message);
    this.code = code;
    this.similar = extra.similar ?? [];
    this.retryAfterS = extra.retryAfterS;
  }
}

export interface TitleInfo {
  title: string;
  /** The words the genre is read from, e.g. "2017 Indonesian supernatural horror". */
  genres: string;
  source: string;
  url: string;
}

/** Lowercase words only, so "Avengers Endgame" finds "Avengers: Endgame". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** External text ends up in the terminal. */
function printable(text: string): string {
  return text.replace(/\p{Cc}/gu, " ").trim().slice(0, 200);
}

/** "Dune (1984)" → the title and the year that narrows it down. */
export function splitYear(input: string): { name: string; year?: string } {
  const match = /^(.+?)\s*\(((?:18|19|20)\d\d)\)$/.exec(input.trim());
  return match ? { name: match[1]!, year: match[2]! } : { name: input.trim() };
}

interface WikiPage {
  index: number;
  title: string;
  description?: string;
  extract?: string;
}

/** How the first sentence of a film or game article reads, and which ones are about something else. */
interface ArticleRules {
  /** Groups: 1 the names, 2 the kind before the noun, 3 (optional) the noun when it can name the genre itself. */
  sentence: RegExp;
  /** A kind that shows the article is about something else. */
  reject: RegExp;
  hasGenre(text: string): boolean;
}

const FILM_ARTICLE: ArticleRules = {
  sentence:
    /^(.{1,300}?) (?:is|was) an? (.{0,160}?)\bfilm\b(?! (?:series|director|producer|studio|festival|company|critic|actor|actress))/,
  // "is a media franchise beginning with the 1968 film", "is an actress and film director"
  reject: /(?:^|\s)(?:by|franchise|series|album|soundtrack|game|actor|actress|singer)(?:\s|,|$)/i,
  hasGenre: (text) => lookForGenres(text) !== undefined,
};

// "is an American video game designer", "is a game show", "is an online game publisher": about something else.
// Not "game developed by" or "game published by", which is how a game's own article goes on.
const AFTER_GAME = [
  "show", "designers?", "developers?", "publish(?:ers?|ing)", "engine", "studio", "company", "console", "series", "franchise",
  "character", "composer", "journalist", "director", "producer", "writer", "artist", "theory", "mode", "controller",
  "soundtrack", "awards?", "magazine", "website", "convention", "festival", "platform", "system", "music", "genre",
  "industry", "streamer",
].join("|");

const GAME_ARTICLE: ArticleRules = {
  // "is a 2022 action role-playing game developed by", "is a 2014 survival horror video game", "is a visual novel".
  // The kind stays inside the first sentence: a publisher's article mentions games in the next one.
  sentence: new RegExp(`^(.{1,300}?) (?:is|was) an? ([^.]{0,160}?)\\b(?:video )?(game|visual novel)\\b(?! (?:${AFTER_GAME})\\b)`),
  // "is an upcoming film based on the video game", "is a fantasy tabletop role-playing game", "is a board game"
  reject:
    /(?:^|\s)(?:by|franchise|series|album|soundtrack|film|television|TV|anime|manga|comic|based|adaptation|board|tabletop|pen-and-paper|dice|actor|actress|singer)(?:\s|,|$)/i,
  hasGenre: (text) => gameLookForGenres(text) !== undefined,
};

/**
 * Picks the article whose title, or another name in its first sentence ("Indonesian: Pengabdi Setan"), is exactly
 * what was typed. It never settles for a similar one: "Wednesday" would become the surf film "Big Wednesday".
 */
function pickArticle(body: unknown, input: string, rules: ArticleRules): { found?: TitleInfo; similar: string[] } {
  const pages = [...((body as { query?: { pages?: WikiPage[] } }).query?.pages ?? [])].sort((a, b) => a.index - b.index);
  const { name, year } = splitYear(input);
  const wanted = normalize(name);
  const similar: string[] = [];
  let byOtherName: TitleInfo | undefined;

  for (const page of pages) {
    if (page.title.startsWith("List of ")) continue;
    const text = (page.extract ?? "").replace(/\s+/g, " ");
    const sentence = rules.sentence.exec(text);
    if (!sentence) continue;
    const [, names = "", before = "", noun] = sentence;
    if (rules.reject.test(before)) continue;
    // "visual novel" names the genre; "game" doesn't.
    const kind = noun && noun !== "game" ? `${before}${noun}` : before;

    similar.push(printable(page.title));
    if (year && !`${page.title} ${kind} ${page.description ?? ""}`.includes(year)) continue;

    const info: TitleInfo = {
      title: printable(page.title),
      // The short description is only a fallback: after " by " it holds names, which could pass for genres.
      genres: printable(rules.hasGenre(kind) ? kind : `${kind} ${page.description?.split(" by ")[0] ?? ""}`),
      source: "Wikipedia (CC BY-SA 4.0)",
      // encodeURI keeps "?" and "#", which would cut off titles like "What's Up with Love?".
      url: `https://en.wikipedia.org/wiki/${encodeURI(page.title.replaceAll(" ", "_")).replaceAll("?", "%3F").replaceAll("#", "%23")}`,
    };
    if (normalize(page.title.replace(/\s*\([^)]*\)$/, "")) === wanted) return { found: info, similar };

    const otherNames = names
      .split(/[();,]/)
      .map((part, i) => normalize(i === 0 ? part : part.trim().replace(/^\p{Lu}\p{Ll}+: /u, "")));
    if (otherNames.includes(wanted)) byOtherName ??= info;
  }
  return byOtherName ? { found: byOtherName, similar } : { similar };
}

/** Picks the film called exactly what was typed from a Wikipedia search (see `pickArticle`). */
export function pickFilm(body: unknown, input: string): { found?: TitleInfo; similar: string[] } {
  return pickArticle(body, input, FILM_ARTICLE);
}

/**
 * Picks the video game called exactly what was typed. Only "... game" sentences count, so "Elden Ring" can't become
 * the film, and board, tabletop and dice games are skipped.
 */
export function pickGame(body: unknown, input: string): { found?: TitleInfo; similar: string[] } {
  return pickArticle(body, input, GAME_ARTICLE);
}

interface TvShow {
  name: string;
  url: string;
  type?: string | null;
  genres?: string[];
  premiered?: string | null;
}

export function pickSeries(body: unknown, input: string): { found?: TitleInfo; similar: string[] } {
  const shows = (body as Array<{ show: TvShow }>).map((entry) => entry.show);
  const { name, year } = splitYear(input);
  const similar = shows.map((show) => printable(show.name));
  const show = shows.find((s) => normalize(s.name) === normalize(name) && (!year || s.premiered?.startsWith(year)));
  if (!show) return { similar };
  return {
    similar,
    found: {
      title: printable(`${show.name}${show.premiered ? ` (${show.premiered.slice(0, 4)})` : ""}`),
      genres: printable([show.type ?? "", ...(show.genres ?? [])].join(" ")),
      source: "TVmaze (CC BY-SA 4.0)",
      url: printable(show.url),
    },
  };
}

async function getJson(url: string, service: string, fetchFn: typeof fetch, flag: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new TitleError("offline", `Can't reach ${service} (${errorMessage(error)}). Pick a look yourself, e.g. ${flag} horror.`);
  }
  if (response.status === 429) {
    const wait = response.headers.get("retry-after") ?? "60";
    const seconds = Number(wait);
    throw new TitleError("rate-limited", `${service} is limiting requests. Try again in ${wait} s, or pick a look with ${flag}.`, {
      ...(Number.isFinite(seconds) ? { retryAfterS: seconds } : {}),
    });
  }
  if (!response.ok) throw new TitleError("http", `${service} answered HTTP ${response.status}. Pick a look with ${flag}.`);
  try {
    return await response.json();
  } catch {
    throw new TitleError("unreadable", `${service} sent an unreadable answer. Pick a look with ${flag}.`);
  }
}

export function defaultCacheDir(): string {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".cache"), "AmbientLight", "titles");
}

/** Looks a title up with one request and remembers it, so a rehearsed demo also starts without internet. */
export async function findTitle(
  kind: TitleKind,
  input: string,
  fetchFn: typeof fetch = fetch,
  cacheDir: string = defaultCacheDir(),
): Promise<TitleInfo> {
  const { name, year } = splitYear(input);
  const example = kind === "game" ? "DreadOut" : "Pengabdi Setan";
  if (normalize(name) === "") throw new TitleError("no-title", `--${kind} needs a title, e.g. --${kind} "${example}"`);
  const flag = lookFlag(kind);

  const key = crypto.createHash("sha256").update(`${kind}:${normalize(name)}:${year ?? ""}`).digest("hex").slice(0, 24);
  const file = path.join(cacheDir, `${key}.json`);
  try {
    // shortcut: cached titles never expire, delete the folder if an article gets a better genre.
    const cached = JSON.parse(await fs.readFile(file, "utf8")) as TitleInfo;
    if (typeof cached.title === "string" && typeof cached.genres === "string") return cached;
  } catch {
    // Not cached yet, or unreadable: look it up.
  }

  let result: { found?: TitleInfo; similar: string[] };
  if (kind === "series") {
    result = pickSeries(await getJson(`${TVMAZE_API}?${new URLSearchParams({ q: name })}`, "TVmaze", fetchFn, flag), input);
  } else {
    const query = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: [name, year, kind === "game" ? "video game" : "film"].filter(Boolean).join(" "),
      gsrlimit: "10",
      prop: "description|extracts",
      exintro: "1",
      explaintext: "1",
      exlimit: "max",
    });
    const body = await getJson(`${WIKIPEDIA_API}?${query}`, "Wikipedia", fetchFn, flag);
    if ((body as { error?: unknown }).error) throw new TitleError("refused", `Wikipedia refused the search. Pick a look with ${flag}.`);
    result = kind === "game" ? pickGame(body, input) : pickFilm(body, input);
  }

  if (!result.found) {
    const close = result.similar.slice(0, 4);
    const similar = close.map((title) => `"${title}"`).join(", ");
    const other = { film: "--series for a TV series, ", series: "--film for a film, ", game: "" }[kind];
    const versions = kind === "game" ? "Doom (2016)" : "Dune (1984)";
    throw new TitleError(
      "not-found",
      `No ${kind} called "${input}" found.${similar ? ` Similar: ${similar}.` : ""}\n` +
        `Use the full title (add the year like "${versions}" to choose a version), ${other}or ${flag} <genre>.`,
      { similar: close },
    );
  }

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(result.found));
  } catch (error) {
    console.warn(`Note: couldn't cache the title, so the next start needs internet again (${errorMessage(error)}).`);
  }
  return result.found;
}

/** A film look (also for series) or a game look. `info` is absent when the look was picked by hand. */
export type ChosenLook =
  | { set: "film"; name: LookName; look: FilmLook; info?: TitleInfo }
  | { set: "game"; name: GameLookName; look: GameLook; info?: TitleInfo };

/** Looks a film, series or game up (see `findTitle`) and picks the look for its genre. */
export async function lookForTitle(
  kind: TitleKind,
  input: string,
  fetchFn: typeof fetch = fetch,
  cacheDir?: string,
): Promise<ChosenLook & { info: TitleInfo }> {
  const info = await findTitle(kind, input, fetchFn, cacheDir);
  const noGenre = () =>
    new TitleError("no-genre", `Found ${info.title}, but no known genre in "${info.genres}". Pick one with ${lookFlag(kind)}.`);
  if (kind === "game") {
    const name = gameLookForGenres(info.genres);
    if (!name) throw noGenre();
    return { set: "game", name, look: GAME_LOOKS[name], info };
  }
  const name = lookForGenres(info.genres);
  if (!name) throw noGenre();
  return { set: "film", name, look: FILM_LOOKS[name], info };
}
