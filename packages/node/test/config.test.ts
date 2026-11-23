import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { applyConfigFile, DEFAULT_CONFIG, loadConfigFile, saveConfigFile, UserError } from "../src/index.js";

describe("saveConfigFile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ambientlight-config-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes a file that loads back to the same config", () => {
    const file = path.join(dir, "nested", "ambientlight.config.json");
    const config = applyConfigFile({ bulbs: ["192.168.1.50"], fps: 15, calibration: { maxDimming: 80 } });
    const saved = saveConfigFile(file, config);

    assert.deepEqual(saved, config);
    assert.deepEqual(applyConfigFile(loadConfigFile(file)), config);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).screen, null);
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

  it("doesn't share arrays or calibration with the defaults", () => {
    const config = applyConfigFile(undefined);
    config.bulbs.push("10.0.0.2");
    config.calibration.gamma = 2;
    assert.deepEqual(DEFAULT_CONFIG.bulbs, []);
    assert.equal(DEFAULT_CONFIG.calibration.gamma, 1.6);
  });
});
