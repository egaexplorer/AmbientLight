import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FILM_LOOKS, GAME_LOOKS, type LookTuning, stepOf, tuneLook, tuningWords } from "../src/index.js";

const SAME: LookTuning = { brightness: 0, warmth: 0, vividness: 0 };

describe("tuneLook", () => {
  it("keeps the look when every step is 0", () => {
    assert.deepEqual(tuneLook(FILM_LOOKS.horror, SAME), FILM_LOOKS.horror);
  });

  it("moves brightness, white and saturation by fixed steps and never the hue", () => {
    const tuned = tuneLook(FILM_LOOKS.horror, { brightness: 2, warmth: 2, vividness: -2 });
    assert.equal(tuned.maxDimming, 65);
    assert.equal(tuned.colorBase, 20);
    assert.equal(tuned.whiteTemp, 4900);
    assert.equal(tuned.saturation, 0.539);
    assert.equal(tuned.hue, FILM_LOOKS.horror.hue);
    assert.equal(tuned.gamma, FILM_LOOKS.horror.gamma);
  });

  it("stays inside the bulb's ranges", () => {
    const bright = tuneLook(FILM_LOOKS.animation, { brightness: 2, warmth: -2, vividness: 0 });
    assert.equal(bright.maxDimming, 100);
    assert.equal(bright.colorBase, 55, "brighter still lifts dark colored scenes on a look already at 100 %");
    assert.equal(tuneLook(FILM_LOOKS.horror, { brightness: 0, warmth: -2, vividness: 0 }).whiteTemp, 6500);
    assert.equal(tuneLook(FILM_LOOKS.romance, { brightness: 0, warmth: 2, vividness: 0 }).whiteTemp, 2200);
    const dark = tuneLook({ ...FILM_LOOKS.horror, maxDimming: 20 }, { brightness: -2, warmth: 0, vividness: 0 });
    assert.deepEqual([dark.maxDimming, dark.colorBase], [10, 10]);
  });

  it("keeps a game look's pace", () => {
    const tuned = tuneLook(GAME_LOOKS.shooter, { brightness: -1, warmth: 0, vividness: 1 });
    assert.equal(tuned.pace, "fast");
    assert.equal(tuned.maxDimming, 90);
  });
});

describe("tuning words", () => {
  it("reads the words for −2 to +2 and nothing else", () => {
    assert.equal(stepOf("brightness", "much dimmer"), -2);
    assert.equal(stepOf("warmth", "same"), 0);
    assert.equal(stepOf("vividness", "much more vivid"), 2);
    assert.equal(stepOf("brightness", "warmer"), undefined);
    assert.equal(stepOf("brightness", 1), undefined);
  });

  it("names only what changed", () => {
    assert.deepEqual(tuningWords(SAME), []);
    assert.deepEqual(tuningWords({ brightness: 1, warmth: 2, vividness: 0 }), ["brighter", "much warmer"]);
  });
});
