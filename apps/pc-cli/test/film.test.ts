import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { LookTuner } from "@ambientlight/node";
import { CliError, parseCommandLine } from "../src/cli.js";
import { chooseLook, describeLook, findTitle, pickFilm, pickGame, pickSeries, splitYear } from "../src/film.js";

const wiki = (...pages: Array<[title: string, extract: string]>) => ({
  query: { pages: pages.map(([title, extract], i) => ({ index: i + 1, title, extract })).reverse() },
});

const HORROR = wiki(
  ["Satan's Slaves", "Satan's Slaves (Indonesian: Pengabdi Setan) is a 2017 Indonesian supernatural horror film by X."],
  ["Satan's Slave (1980 film)", "Satan's Slave (Indonesian: Pengabdi Setan) is a 1980 Indonesian horror film by Y."],
);

describe("pickFilm", () => {
  it("finds a film by the other name in its first sentence, best match first", () => {
    const { found } = pickFilm(HORROR, "pengabdi setan");
    assert.equal(found!.title, "Satan's Slaves");
    assert.equal(found!.genres, "2017 Indonesian supernatural horror");
  });

  it("lets a year choose the version", () => {
    assert.equal(pickFilm(HORROR, "Pengabdi Setan (1980)").found!.title, "Satan's Slave (1980 film)");
    assert.equal(pickFilm(HORROR, "Pengabdi Setan (1999)").found, undefined);
  });

  it("prefers the exact title over a sequel ranked higher", () => {
    const body = wiki(
      ["Agak Laen: Menyala Pantiku!", "Agak Laen: Menyala Pantiku! is a 2025 Indonesian comedy film by X."],
      ["Agak Laen", "Agak Laen (lit. 'A bit different') is a 2024 Indonesian comedy horror film by X."],
    );
    assert.equal(pickFilm(body, "Agak Laen").found!.title, "Agak Laen");
  });

  it("ignores punctuation and accents", () => {
    const body = wiki(["Avengers: Endgame", "Avengers: Endgame is a 2019 American superhero film by X."]);
    assert.equal(pickFilm(body, "avengers endgame").found!.title, "Avengers: Endgame");
    assert.equal(pickFilm(wiki(["Amélie", "Amélie is a 2001 French romantic comedy film."]), "Amelie").found!.title, "Amélie");
  });

  it("never settles for a similar title", () => {
    const { found, similar } = pickFilm(wiki(["Big Wednesday", "Big Wednesday is a 1978 American drama film."]), "Wednesday");
    assert.equal(found, undefined);
    assert.deepEqual(similar, ["Big Wednesday"]);
  });

  it("skips franchises, soundtracks, people and lists", () => {
    const body = wiki(
      ["Night (film series)", "Night is a zombie media franchise beginning with the 1968 film Night."],
      ["Night (soundtrack)", "Night is the soundtrack album for a film. It is a score album for the film Night."],
      ["Night (actress)", "Night is an Indonesian actress and film director."],
      ["List of Night films", "Night is a 1968 horror film."],
      ["Night", "Night is a 1968 American horror film."],
    );
    const { found, similar } = pickFilm(body, "Night");
    assert.equal(found!.title, "Night");
    assert.deepEqual(similar, ["Night"]);
  });

  it("links titles that contain a question mark", () => {
    const body = wiki(["What's Up with Love?", "Ada Apa dengan Cinta? is a 2002 Indonesian romance film."]);
    assert.ok(pickFilm(body, "Ada Apa Dengan Cinta").found!.url.endsWith("Love%3F"));
  });

  it("copes with an empty answer", () => {
    assert.deepEqual(pickFilm({ batchcomplete: true }, "zzz"), { similar: [] });
  });
});

describe("pickGame", () => {
  it("takes only video games, so a title shared with a film finds the game", () => {
    const body = wiki(
      ["Elden Ring (film)", "Elden Ring is an upcoming American dark fantasy film based on the video game."],
      ["Elden Ring", "Elden Ring is a 2022 action role-playing game developed by FromSoftware."],
    );
    const { found, similar } = pickGame(body, "elden ring");
    assert.equal(found!.title, "Elden Ring");
    assert.equal(found!.genres, "2022 action role-playing");
    assert.deepEqual(similar, ["Elden Ring"]);
  });

  it("skips board and tabletop games, series of games and people", () => {
    const body = wiki(
      ["Night (board game)", "Night is a board game for two players designed by X."],
      ["Night (role-playing game)", "Night is a fantasy tabletop role-playing game."],
      ["Night (series)", "Night is a series of video games."],
      ["Night (designer)", "Night is an American video game designer."],
      ["Night (publisher)", "Night is an online game publisher. It was one of the first game publishing companies."],
      ["Night (video game)", "Night is a 2019 survival horror video game developed by X."],
    );
    const { found, similar } = pickGame(body, "Night");
    assert.equal(found!.title, "Night (video game)");
    assert.equal(found!.genres, "2019 survival horror");
    assert.deepEqual(similar, ["Night (video game)"]);
  });

  it("reads a visual novel as a genre, and finds other names and years", () => {
    const novel = wiki(["Kopi Talk", "Kopi Talk (Indonesian: Ngobrol Kopi) is a 2020 visual novel developed by X."]);
    const { found } = pickGame(novel, "Ngobrol Kopi");
    assert.equal(found!.title, "Kopi Talk");
    assert.equal(found!.genres, "2020 visual novel");
    const doom = wiki(
      ["Doom (1993 video game)", "Doom is a 1993 first-person shooter game developed by id Software."],
      ["Doom (2016 video game)", "Doom is a 2016 first-person shooter game developed by id Software."],
    );
    assert.equal(pickGame(doom, "Doom (2016)").found!.title, "Doom (2016 video game)");
    assert.equal(pickGame(doom, "Doom").found!.title, "Doom (1993 video game)");
  });
});

describe("pickSeries", () => {
  it("needs the exact name and reads the genres", () => {
    const show = { name: "Wednesday", url: "https://www.tvmaze.com/shows/1", type: "Scripted", genres: ["Comedy"], premiered: "2022-11-23" };
    const { found } = pickSeries([{ show }], "wednesday");
    assert.equal(found!.title, "Wednesday (2022)");
    assert.equal(found!.genres, "Scripted Comedy");
    assert.equal(pickSeries([{ show }], "Wednesdays").found, undefined);
  });
});

describe("findTitle and chooseLook", () => {
  let cache = "";
  before(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "ambientlight-titles-"));
  });
  after(async () => {
    await fs.rm(cache, { recursive: true, force: true });
  });

  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  it("asks once, then works without internet", async () => {
    let calls = 0;
    const online = (async () => {
      calls++;
      return Response.json(HORROR);
    }) as typeof fetch;
    assert.equal((await chooseLook({ ...flags(), film: "Pengabdi Setan" }, online, cache))!.name, "horror");
    assert.equal((await chooseLook({ ...flags(), film: "pengabdi setan" }, offline, cache))!.name, "horror");
    assert.equal(calls, 1);
  });

  it("explains a lost connection, a rate limit and an unknown title", async () => {
    const limited = (async () => new Response("", { status: 429, headers: { "retry-after": "7" } })) as typeof fetch;
    const empty = (async () => Response.json({ batchcomplete: true })) as typeof fetch;
    await assert.rejects(findTitle("film", "Dune", offline, cache), /--look/);
    await assert.rejects(findTitle("film", "Dune", limited, cache), /7 s/);
    await assert.rejects(findTitle("film", "Dune", empty, cache), /No film called "Dune"/);
    await assert.rejects(findTitle("film", "  ", offline, cache), CliError);
  });

  it("lets an AI tune a title's look unless --no-ai, and says what it did", async () => {
    const online = (async () => Response.json(HORROR)) as typeof fetch;
    let asked = 0;
    const tuner: LookTuner = {
      name: "Fake AI",
      tune: async () => {
        asked++;
        return { brightness: -1, warmth: 0, vividness: 0, reason: "Grim.", by: "Fake AI" };
      },
    };
    const tuned = (await chooseLook({ ...flags(), film: "Pengabdi Setan" }, online, cache, tuner))!;
    assert.equal(tuned.look.maxDimming, 35);
    assert.match(describeLook(tuned), /\nAI: {5}Fake AI: dimmer\. "Grim\."\nLook: {3}horror look, tuned by AI \(brightness up to 35%/);

    const off = (await chooseLook({ ...flags(), film: "Pengabdi Setan", noAi: true }, online, cache, tuner))!;
    assert.equal(off.look.maxDimming, 45);
    assert.match(describeLook(off), /AI: {5}off \(--no-ai\)/);
    const noKey = (await chooseLook({ ...flags(), film: "Pengabdi Setan" }, online, cache))!;
    assert.match(describeLook(noKey), /AI: {5}off \(no GEMINI_API_KEY or GROQ_API_KEY in \.env\)/);
    assert.equal(asked, 1);
    assert.doesNotMatch(describeLook((await chooseLook({ ...flags(), look: "horror" }, online, cache, tuner))!), /AI:/);
  });

  it("needs no internet for --look and --game-look, and does nothing without a flag", async () => {
    assert.equal((await chooseLook({ ...flags(), look: "romance" }, offline, cache))!.name, "romance");
    const shooter = (await chooseLook({ ...flags(), gameLook: "shooter" }, offline, cache))!;
    assert.deepEqual([shooter.set, shooter.name], ["game", "shooter"]);
    assert.match(describeLook(shooter), /shooter game look .*fast: smoothing at least 0\.95/);
    assert.equal(await chooseLook(flags(), offline, cache), undefined);
  });
});

function flags() {
  return parseCommandLine(["sync"]).flags;
}

describe("film options", () => {
  it("takes one of --film, --series, --look, --game and --game-look, for sync and once", () => {
    assert.equal(parseCommandLine(["sync", "--film", "Dune (1984)"]).flags.film, "Dune (1984)");
    assert.equal(parseCommandLine(["once", "--look", "horror"]).flags.look, "horror");
    assert.throws(() => parseCommandLine(["sync", "--look", "horor"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--look", "horror", "--film", "Dune"]), CliError);
    assert.throws(() => parseCommandLine(["color", "--look", "horror"]), CliError);
    assert.equal(parseCommandLine(["sync", "--game", "DreadOut"]).flags.game, "DreadOut");
    assert.equal(parseCommandLine(["once", "--game-look", "racing"]).flags.gameLook, "racing");
    assert.throws(() => parseCommandLine(["sync", "--game-look", "thriller"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--game", "Doom", "--look", "horror"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--game", "Doom", "--film", "Doom"]), CliError);
    assert.throws(() => parseCommandLine(["on", "--game-look", "cozy"]), CliError);
  });

  it("splits a trailing year", () => {
    assert.deepEqual(splitYear("Dune (1984)"), { name: "Dune", year: "1984" });
    assert.deepEqual(splitYear("2012"), { name: "2012" });
  });
});
