import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { FILM_LOOKS, type FilmLook, GAME_LOOKS } from "@ambientlight/core";
import { applyConfigFile, DEFAULT_CONFIG, loadConfigFile, saveConfigFile, syncOptionsFor, UserError } from "../src/index.js";

describe("saveConfigFile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ambientlight-config-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes a file that loads back to the same config", () => {
    const file = path.join(dir, "nested", "ambientlight.config.json");
    const config = applyConfigFile({ bulbs: ["192.168.1.50"], fps: 15, calibration: { maxDimming: 80 } });
    const saved = saveConfigFile(file, config);

    assert.deepEqual(saved, config);
    assert.deepEqual(applyConfigFile(loadConfigFile(file)), config);
    // Only what differs from the defaults is written, so new defaults still apply.
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { bulbs: ["192.168.1.50"], fps: 15, calibration: { maxDimming: 80 } });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["ambientlight.config.json"]);
  });

  it("refuses invalid values and leaves the old file alone", () => {
    const file = path.join(dir, "ambientlight.config.json");
    saveConfigFile(file, applyConfigFile({ bulbs: ["192.168.1.50"] }));
    const before = fs.readFileSync(file, "utf8");

    assert.throws(() => saveConfigFile(file, { ...DEFAULT_CONFIG, fps: 500 }), UserError);
    const cal = { ...DEFAULT_CONFIG.calibration, minDimming: 90, maxDimming: 50 };
    assert.throws(() => saveConfigFile(file, { ...DEFAULT_CONFIG, calibration: cal }), /minDimming/);
    assert.equal(fs.readFileSync(file, "utf8"), before);
  });

  it("writes a chosen display, and null for a cleared one only when it differs", () => {
    const file = path.join(dir, "display.json");
    saveConfigFile(file, applyConfigFile({ screen: "\\\\.\\DISPLAY2" }));
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).screen, "\\\\.\\DISPLAY2");
    saveConfigFile(file, applyConfigFile({}));
    assert.equal("screen" in JSON.parse(fs.readFileSync(file, "utf8")), false);
  });

  it("doesn't share arrays or calibration with the defaults", () => {
    const config = applyConfigFile(undefined);
    config.bulbs.push("10.0.0.2");
    config.calibration.gamma = 2;
    assert.deepEqual(DEFAULT_CONFIG.bulbs, []);
    assert.equal(DEFAULT_CONFIG.calibration.gamma, 1.6);
  });
});

describe("syncOptionsFor", () => {
  it("scales the look's top brightness with the brightness setting, 70 meaning as designed", () => {
    const top = (brightness: number, look?: FilmLook) =>
      syncOptionsFor({ ...DEFAULT_CONFIG, brightness }, look).calibration?.maxDimming;
    assert.equal(top(70, FILM_LOOKS.horror), 45);
    assert.ok(Math.abs((top(100, FILM_LOOKS.horror) ?? 0) - 64.2857) < 0.001);
    assert.equal(top(70), 100);
    assert.equal(top(35), 50);
  });

  it("lets a game look's pace move smoothing and scene cuts, and nothing else", () => {
    const fast = syncOptionsFor(DEFAULT_CONFIG, GAME_LOOKS.shooter);
    assert.deepEqual([fast.smoothing, fast.sceneCut], [0.95, 25]);
    assert.deepEqual(fast.calibration, syncOptionsFor(DEFAULT_CONFIG, FILM_LOOKS.action).calibration);
    assert.equal(syncOptionsFor(DEFAULT_CONFIG, GAME_LOOKS.cozy).smoothing, 0.4);
    assert.equal(syncOptionsFor(DEFAULT_CONFIG, GAME_LOOKS.horror).smoothing, DEFAULT_CONFIG.smoothing);
    assert.equal(syncOptionsFor(DEFAULT_CONFIG, FILM_LOOKS.action).smoothing, DEFAULT_CONFIG.smoothing);
  });

  it("saves a brightness only when it differs from 70", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ambientlight-brightness-"));
    try {
      const file = path.join(dir, "ambientlight.config.json");
      saveConfigFile(file, applyConfigFile({ brightness: 70 }));
      assert.equal("brightness" in JSON.parse(fs.readFileSync(file, "utf8")), false);
      assert.equal(saveConfigFile(file, applyConfigFile({ brightness: 90 })).brightness, 90);
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).brightness, 90);
      assert.throws(() => saveConfigFile(file, { ...DEFAULT_CONFIG, brightness: 5 }), /between 10 and 100/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
