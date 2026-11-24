import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { lookForTitle, TitleError, type TitleErrorCode, UserError } from "../src/index.js";

const page = (title: string, extract: string) => ({ query: { pages: [{ index: 1, title, extract }] } });

describe("lookForTitle", () => {
  let cache = "";
  before(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "ambientlight-node-titles-"));
  });
  after(async () => {
    await fs.rm(cache, { recursive: true, force: true });
  });

  const answer = (body: unknown, init?: ResponseInit) => (async () => Response.json(body, init)) as typeof fetch;
  const code = async (promise: Promise<unknown>): Promise<TitleErrorCode> => {
    try {
      await promise;
    } catch (error) {
      assert.ok(error instanceof TitleError);
      assert.ok(error instanceof UserError);
      return error.code;
    }
    throw new Error("expected a TitleError");
  };

  it("returns the look, the title and its source", async () => {
    const chosen = await lookForTitle("film", "Sintel", answer(page("Sintel", "Sintel is a 2010 animated fantasy short film.")), cache);
    assert.deepEqual([chosen.set, chosen.name], ["film", "animation"]);
    assert.equal(chosen.info.title, "Sintel");
    assert.equal(chosen.info.source, "Wikipedia (CC BY-SA 4.0)");
  });

  it("gives every failure a code, so an app can word its own advice", async () => {
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    assert.equal(await code(lookForTitle("film", "  ", offline, cache)), "no-title");
    assert.equal(await code(lookForTitle("film", "Dune", offline, cache)), "offline");
    assert.equal(await code(lookForTitle("film", "Dune", answer({}, { status: 500 }), cache)), "http");
    assert.equal(await code(lookForTitle("film", "Dune", answer({ error: { code: "x" } }), cache)), "refused");
    assert.equal(await code(lookForTitle("film", "Dune", answer({ batchcomplete: true }), cache)), "not-found");
    assert.equal(
      await code(lookForTitle("film", "Quiet Days", answer(page("Quiet Days", "Quiet Days is a 1999 film.")), cache)),
      "no-genre",
    );
  });

  it("finds a game look, and words its advice for --game-look", async () => {
    const dread = page("DreadOut", "DreadOut is a 2014 survival horror video game developed by Digital Happiness.");
    const chosen = await lookForTitle("game", "DreadOut", answer(dread), cache);
    assert.ok(chosen.set === "game");
    assert.deepEqual([chosen.name, chosen.look.pace], ["horror", "normal"]);
    assert.equal(chosen.info.genres, "2014 survival horror");
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await assert.rejects(lookForTitle("game", "Doom", offline, cache), /--game-look/);
    const online = page("Fortnite", "Fortnite is an online video game developed by Epic Games.");
    await assert.rejects(lookForTitle("game", "Fortnite", answer(online), cache), (error: TitleError) => error.code === "no-genre");
  });

  it("reports the wait of a rate limit and the titles that came close", async () => {
    const limited = (async () => new Response("", { status: 429, headers: { "retry-after": "7" } })) as typeof fetch;
    await assert.rejects(lookForTitle("film", "Dune", limited, cache), (error: TitleError) => error.retryAfterS === 7);
    const close = answer(page("Dune Part Two", "Dune Part Two is a 2024 science fiction film."));
    await assert.rejects(lookForTitle("film", "Dune", close, cache), (error: TitleError) => error.similar[0] === "Dune Part Two");
  });
});
