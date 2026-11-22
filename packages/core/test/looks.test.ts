import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLook,
  calibrate,
  DEFAULT_CALIBRATION,
  FILM_LOOKS,
  hsvToRgb,
  LOOK_NAMES,
  lookForGenres,
  MAX_HUE_TURN,
  rgbToHsv,
  SyncEngine,
  turnHue,
  type WizColor,
} from "../src/index.js";
import { FakeCapturer, FakeClock, RecordingSink, solidFrame } from "./helpers.js";

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
const vivid = (h: number) => hsvToRgb({ h, s: 0.9, v: 0.9 });

describe("lookForGenres", () => {
  it("reads the first genre that matters", () => {
    const cases: Array<[string, string]> = [
      ["2017 Indonesian supernatural horror", "horror"],
      ["2024 Indonesian comedy horror", "comedy"],
      ["2013 American animated musical fantasy", "animation"],
      ["2004 American romantic drama", "romance"],
      ["2023 satirical fantasy comedy", "comedy"],
      ["2014 epic science fiction drama", "scifi"],
      ["2019 American superhero", "action"],
      ["2019 American psychological thriller", "thriller"],
      ["2008 Indonesian drama", "drama"],
      ["Scripted Drama Horror Science-Fiction", "horror"],
    ];
    for (const [text, look] of cases) assert.equal(lookForGenres(text), look, text);
  });

  it("doesn't find genres inside other words", () => {
    assert.equal(lookForGenres("2016 Indonesian"), undefined);
    assert.equal(lookForGenres("award-winning warm software"), undefined);
  });
});

describe("turnHue", () => {
  it("leans toward the target by at most MAX_HUE_TURN and never past it", () => {
    for (let h = 0; h < 360; h += 1) {
      for (const target of [0, 30, 200, 340]) {
        const after = rgbToHsv(turnHue(vivid(h), target)).h;
        assert.ok(hueGap(after, h) <= MAX_HUE_TURN + 1e-6, `${h} toward ${target} moved too far`);
        assert.ok(hueGap(after, target) <= hueGap(h, target) + 1e-6, `${h} moved away from ${target}`);
      }
    }
  });

  it("changes smoothly, so a panning camera doesn't make the light jump", () => {
    let previous = rgbToHsv(turnHue(vivid(0), 30)).h;
    for (let h = 1; h <= 360; h += 1) {
      const after = rgbToHsv(turnHue(vivid(h), 30)).h;
      assert.ok(hueGap(after, previous) < 3, `jump at ${h}`);
      previous = after;
    }
  });

  it("leaves distant colors alone, so teal stays teal in a warm look", () => {
    const after = rgbToHsv(turnHue(vivid(180), 30)).h;
    assert.ok(hueGap(after, 180) < 1e-6);
  });

  it("keeps grays, saturation and value", () => {
    assert.deepEqual(turnHue({ r: 90, g: 90, b: 90 }, 200), { r: 90, g: 90, b: 90 });
    const before = hsvToRgb({ h: 40, s: 0.4, v: 0.6 });
    const after = rgbToHsv(turnHue(before, 340));
    assert.ok(Math.abs(after.s - 0.4) < 1e-6 && Math.abs(after.v - 0.6) < 1e-6);
  });

  it("leaves muted greens alone (the doorway shot would look yellow again)", () => {
    const doorway = { r: 32, g: 35, b: 25 };
    const turned = turnHue(doorway, FILM_LOOKS.romance.hue, doorway);
    assert.ok(hueGap(rgbToHsv(turned).h, rgbToHsv(doorway).h) < 1e-6);
  });
});

describe("applyLook", () => {
  it("keeps every look inside the ranges the config accepts", () => {
    for (const name of LOOK_NAMES) {
      const c = applyLook(DEFAULT_CALIBRATION, FILM_LOOKS[name]);
      assert.ok(c.saturationBoost <= 5 && c.gamma > 0 && c.gamma <= 5, name);
      assert.ok(c.minDimming <= c.colorBaseBrightness && c.colorBaseBrightness <= c.maxDimming, name);
      assert.ok(c.whiteTemp >= 2200 && c.whiteTemp <= 6500, name);
    }
  });

  it("only lowers the user's brightness limit", () => {
    assert.equal(applyLook(DEFAULT_CALIBRATION, FILM_LOOKS.horror).maxDimming, 45);
    assert.equal(applyLook({ ...DEFAULT_CALIBRATION, maxDimming: 30 }, FILM_LOOKS.horror).maxDimming, 30);
  });

  it("shrinks the color base with the cap, so scenes don't all get the same brightness", () => {
    const c = applyLook({ ...DEFAULT_CALIBRATION, colorBaseBrightness: 50 }, FILM_LOOKS.horror);
    assert.ok(c.colorBaseBrightness > 10 && c.colorBaseBrightness < 30);
    const dark = calibrate({ r: 60, g: 15, b: 15 }, c).dimming;
    const bright = calibrate({ r: 240, g: 40, b: 40 }, c).dimming;
    assert.ok(bright - dark >= 10);
  });
});

describe("SyncEngine with a film look", () => {
  const run = async (hueTarget?: number): Promise<WizColor[]> => {
    const sink = new RecordingSink();
    const engine = new SyncEngine(
      new FakeCapturer(solidFrame(200, 120, 40)),
      [sink],
      { smoothing: 1, hueTarget },
      {},
      new FakeClock(),
    );
    await engine.tick();
    return sink.colors;
  };

  it("turns the hue before calibrating", async () => {
    const color = { r: 200, g: 120, b: 40 };
    const [sent] = await run(340);
    assert.notDeepEqual(sent, (await run())[0]);
    assert.equal(sent!.dimming, calibrate(color).dimming);
  });
});
