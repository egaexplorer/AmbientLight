import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLook,
  applyPace,
  CALM_SMOOTHING,
  DEFAULT_CALIBRATION,
  FAST_SCENE_CUT,
  FAST_SMOOTHING,
  FILM_LOOKS,
  GAME_LOOK_NAMES,
  GAME_LOOKS,
  gameLookForGenres,
} from "../src/index.js";

describe("gameLookForGenres", () => {
  it("reads the genre that decides how a game feels", () => {
    const cases: Array<[string, string]> = [
      ["2014 survival horror", "horror"],
      ["2023 horror visual novel", "horror"],
      ["2021 racing", "racing"],
      ["2023 football simulation", "racing"],
      ["2020 first-person tactical hero shooter", "shooter"],
      ["2024 fighting", "shooter"],
      ["2019 hack and slash action-adventure", "shooter"],
      ["2012 shoot 'em up", "shooter"],
      ["2020 coffee-brewing visual novel", "cozy"],
      ["2016 farm life simulation", "cozy"],
      ["2007 puzzle-platform", "cozy"],
      ["2017 Metroidvania action-adventure", "platformer"],
      ["2016 turn-based strategy 4X", "strategy"],
      ["2013 multiplayer online battle arena", "strategy"],
      ["2014 free-to-play digital collectible card", "strategy"],
      ["2022 action role-playing", "adventure"],
      ["2011 sandbox", "adventure"],
      ["2023 slice-of-life adventure", "adventure"],
    ];
    for (const [text, look] of cases) assert.equal(gameLookForGenres(text), look, text);
  });

  it("doesn't read where a game runs as how it plays", () => {
    assert.equal(gameLookForGenres("2019 cross-platform battle royale"), "shooter");
    assert.equal(gameLookForGenres("2016 cross-platform multiplayer online battle arena"), "strategy");
    assert.equal(gameLookForGenres("2020 online"), undefined);
    assert.equal(gameLookForGenres("2018 Indonesian"), undefined);
  });
});

describe("GAME_LOOKS", () => {
  it("use the colors of a film look, so retuning one retunes both", () => {
    const { pace, ...colors } = GAME_LOOKS.shooter;
    assert.equal(pace, "fast");
    assert.deepEqual(colors, FILM_LOOKS.action);
  });

  it("stay inside the ranges the config accepts", () => {
    for (const name of GAME_LOOK_NAMES) {
      const c = applyLook(DEFAULT_CALIBRATION, GAME_LOOKS[name]);
      assert.ok(c.saturationBoost <= 5 && c.gamma > 0 && c.gamma <= 5, name);
      assert.ok(c.minDimming <= c.colorBaseBrightness && c.colorBaseBrightness <= c.maxDimming, name);
      assert.ok(c.whiteTemp >= 2200 && c.whiteTemp <= 6500, name);
    }
  });
});

describe("applyPace", () => {
  const defaults = { smoothing: 0.7, sceneCut: 40 };

  it("speeds fast games up and slows calm ones down", () => {
    assert.deepEqual(applyPace(defaults, "fast"), { smoothing: FAST_SMOOTHING, sceneCut: FAST_SCENE_CUT });
    assert.deepEqual(applyPace(defaults, "calm"), { smoothing: CALM_SMOOTHING, sceneCut: 40 });
    assert.deepEqual(applyPace(defaults, "normal"), defaults);
  });

  it("only moves the user's own setting in the pace's direction", () => {
    assert.deepEqual(applyPace({ smoothing: 1, sceneCut: 0 }, "fast"), { smoothing: 1, sceneCut: 0 });
    assert.deepEqual(applyPace({ smoothing: 0.2, sceneCut: 40 }, "calm"), { smoothing: 0.2, sceneCut: 40 });
  });
});
