import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { FILM_LOOKS } from "@ambientlight/core";
import {
  checkTuning,
  createLookTuner,
  findTitle,
  type LookTuner,
  lookForTitle,
  pickSeries,
  summaryText,
  type TitleTuning,
  type TuningRequest,
} from "../src/index.js";

const reply = (fields: Record<string, unknown>) =>
  JSON.stringify({ reason: "A grim story set at night.", brightness: "dimmer", warmth: "same", vividness: "softer", ...fields });

describe("checkTuning", () => {
  it("turns the allowed words into steps", () => {
    assert.deepEqual(checkTuning(reply({})), { brightness: -1, warmth: 0, vividness: -1, reason: "A grim story set at night." });
    assert.equal(checkTuning(`\`\`\`json\n${reply({ warmth: "much warmer" })}\n\`\`\``).warmth, 2);
  });

  it("rejects anything outside the steps, and answers without a usable reason", () => {
    assert.throws(() => checkTuning(reply({ brightness: "much much brighter" })), /brightness/);
    assert.throws(() => checkTuning(reply({ warmth: 3 })), /warmth/);
    assert.throws(() => checkTuning(reply({ vividness: undefined })), /vividness/);
    assert.throws(() => checkTuning(reply({ reason: " " })), /reason/);
    assert.throws(() => checkTuning(reply({ reason: "x".repeat(201) })), /reason/);
    assert.throws(() => checkTuning("Sure! Here is the look."), /JSON/);
    assert.equal(checkTuning(reply({ reason: "Dark\u0007 and\n cold." })).reason, "Dark and cold.");
  });
});

describe("createLookTuner", () => {
  const request: TuningRequest = {
    kind: "film",
    title: "Satan's Slaves",
    genres: "2017 Indonesian supernatural horror",
    summary: "A family is haunted after their mother dies.",
    lookName: "horror",
    look: FILM_LOOKS.horror,
  };

  it("needs a key, sends allowed words as a schema, and never sends the key in the body", async () => {
    assert.equal(createLookTuner({ GEMINI_API_KEY: " " }), undefined);
    let body: any;
    let auth = "";
    const ok = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      auth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ choices: [{ message: { content: reply({}) } }] });
    }) as typeof fetch;
    const tuner = createLookTuner({ GEMINI_API_KEY: "secret-key" }, ok)!;
    const tuning = await tuner.tune(request);
    assert.equal(tuning.brightness, -1);
    assert.equal(tuning.by, tuner.name);
    assert.match(tuner.name, /^Gemini/);
    assert.equal(auth, "Bearer secret-key");
    assert.ok(!JSON.stringify(body).includes("secret-key"));
    const schema = body.response_format.json_schema.schema;
    assert.deepEqual(schema.required, ["reason", "brightness", "warmth", "vividness"]);
    assert.deepEqual(schema.properties.warmth.enum, ["much cooler", "cooler", "same", "warmer", "much warmer"]);
    assert.equal(JSON.parse(body.messages[1].content).summary, request.summary);
  });

  it("reports failures without the key", async () => {
    const down = (async () => new Response("bad key secret-key", { status: 401 })) as typeof fetch;
    await assert.rejects(
      createLookTuner({ GROQ_API_KEY: "secret-key" }, down)!.tune(request),
      (error: Error) => error.message.startsWith("Groq HTTP 401") && !error.message.includes("secret-key"),
    );
    const offline = (async () => {
      throw new Error("fetch failed for secret-key");
    }) as typeof fetch;
    await assert.rejects(
      createLookTuner({ GEMINI_API_KEY: "secret-key" }, offline)!.tune(request),
      (error: Error) => /Can't reach Gemini/.test(error.message) && !error.message.includes("secret-key"),
    );
  });
});

describe("lookForTitle with a tuner", () => {
  let cache = "";
  before(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "ambientlight-look-ai-"));
  });
  after(async () => {
    await fs.rm(cache, { recursive: true, force: true });
  });

  const wiki = (title: string, extract: string) =>
    (async () => Response.json({ query: { pages: [{ index: 1, title, extract }] } })) as typeof fetch;
  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const fakeTuner = (answer: Omit<TitleTuning, "by"> | Error) => {
    const asked: TuningRequest[] = [];
    const tuner: LookTuner = {
      name: "Fake AI",
      async tune(request) {
        asked.push(request);
        if (answer instanceof Error) throw answer;
        return { ...answer, by: "Fake AI" };
      },
    };
    return { tuner, asked };
  };
  const TUNING = { brightness: 1, warmth: 1, vividness: 0, reason: "A comedy at heart." } as const;

  it("nudges the genre look, and asks only once per title", async () => {
    const { tuner, asked } = fakeTuner(TUNING);
    const extract = "Agak Laen is a 2024 Indonesian horror comedy film. Four friends run a ghost house.";
    const chosen = await lookForTitle("film", "Agak Laen", wiki("Agak Laen", extract), cache, tuner);
    assert.equal(chosen.name, "comedy");
    assert.equal(chosen.tuning?.reason, "A comedy at heart.");
    assert.equal(chosen.look.whiteTemp, FILM_LOOKS.comedy.whiteTemp - 800);
    assert.equal(chosen.look.colorBase, FILM_LOOKS.comedy.colorBase + 5);
    assert.equal(asked[0]!.summary, extract);
    assert.equal(asked[0]!.lookName, "comedy");

    const again = await lookForTitle("film", "agak laen", offline, cache, tuner);
    assert.equal(asked.length, 1, "the title and its tuning both come from the cache");
    assert.deepEqual(again.look, chosen.look);
  });

  it("keeps the genre look when the AI fails, and says why", async () => {
    const { tuner } = fakeTuner(new Error("Gemini HTTP 429: quota"));
    const chosen = await lookForTitle("film", "Sintel", wiki("Sintel", "Sintel is a 2010 animated fantasy short film."), cache, tuner);
    assert.equal(chosen.tuning, undefined);
    assert.equal(chosen.aiError, "Gemini HTTP 429: quota");
    assert.deepEqual(chosen.look, FILM_LOOKS.animation);
  });

  it("doesn't ask without a summary", async () => {
    const { tuner, asked } = fakeTuner(TUNING);
    const body = [{ show: { name: "Lost", url: "https://www.tvmaze.com/shows/123/lost", genres: ["Drama"], summary: null } }];
    const chosen = await lookForTitle("series", "Lost", (async () => Response.json(body)) as typeof fetch, cache, tuner);
    assert.equal(asked.length, 0);
    assert.match(chosen.aiError ?? "", /TVmaze has no summary/);
  });
});

describe("summaries", () => {
  let cache = "";
  before(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "ambientlight-summaries-"));
  });
  after(async () => {
    await fs.rm(cache, { recursive: true, force: true });
  });
  const wiki = (title: string, extract: string) =>
    (async () => Response.json({ query: { pages: [{ index: 1, title, extract }] } })) as typeof fetch;
  const offline = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  it("reads TVmaze's HTML as plain text", () => {
    const show = { name: "Wednesday", url: "u", genres: ["Comedy"], summary: "<p><b>Wednesday</b> is a sleuthing &amp; supernaturally infused mystery.</p>" };
    assert.equal(pickSeries([{ show }], "Wednesday").found?.summary, "Wednesday is a sleuthing & supernaturally infused mystery.");
    assert.equal(summaryText(`a\u0000b ${"x".repeat(2000)}`).length, 1500);
  });

  it("looks a title cached without a summary up again, and keeps the old entry when that fails", async () => {
    const old = { title: "Sintel", genres: "2010 animated fantasy short", source: "Wikipedia (CC BY-SA 4.0)", url: "u" };
    // Let findTitle create its cache file, then replace it with an entry from before summaries were kept.
    await findTitle("film", "Sintel", wiki("Sintel", "Sintel is a 2010 animated fantasy short film."), cache);
    const [name] = await fs.readdir(cache);
    await fs.writeFile(path.join(cache, name!), JSON.stringify(old));
    assert.deepEqual(await findTitle("film", "Sintel", offline, cache), old);
    const fresh = await findTitle("film", "Sintel", wiki("Sintel", "Sintel is a 2010 animated fantasy short film. New."), cache);
    assert.equal(fresh.summary, "Sintel is a 2010 animated fantasy short film. New.");
  });
});
