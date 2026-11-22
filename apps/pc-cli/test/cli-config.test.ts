import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { CliError, parseCommandLine } from "../src/cli.js";
import { DEFAULT_CONFIG, resolveConfig, validateConfigFile } from "../src/config.js";

describe("parseCommandLine", () => {
  it("takes --save-frame for once only", () => {
    assert.equal(parseCommandLine(["once", "--save-frame", "lamp.png"]).flags.saveFrame, "lamp.png");
    assert.throws(() => parseCommandLine(["sync", "--save-frame", "lamp.png"]), CliError);
  });

  it("defaults to help", () => {
    assert.equal(parseCommandLine([]).command, "help");
  });

  it("collects repeated and comma-separated bulbs and numeric flags", () => {
    const { command, flags } = parseCommandLine([
      "sync",
      "--bulb",
      "192.168.1.50, 192.168.1.51",
      "-b",
      "192.168.1.52",
      "--fps",
      "12",
      "--no-restore",
    ]);
    assert.equal(command, "sync");
    assert.deepEqual(flags.bulbs, ["192.168.1.50", "192.168.1.51", "192.168.1.52"]);
    assert.equal(flags.fps, 12);
    assert.equal(flags.noRestore, true);
  });

  it("parses --rgb and numeric display ids", () => {
    const { flags } = parseCommandLine(["color", "--rgb", "255,120,0", "--screen", "2"]);
    assert.deepEqual(flags.rgb, { r: 255, g: 120, b: 0 });
    assert.equal(flags.screen, 2);
    assert.equal(parseCommandLine(["once", "--screen", "\\\\.\\DISPLAY1"]).flags.screen, "\\\\.\\DISPLAY1");
  });

  it("knows the read-only state command", () => {
    assert.equal(parseCommandLine(["state"]).command, "state");
  });

  it("knows the on and off commands", () => {
    assert.equal(parseCommandLine(["on"]).command, "on");
    assert.equal(parseCommandLine(["off", "--bulb", "192.168.1.50"]).flags.bulbs?.[0], "192.168.1.50");
  });

  it("reports user mistakes as CliError", () => {
    assert.throws(() => parseCommandLine(["dance"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--fps", "fast"]), CliError);
    assert.throws(() => parseCommandLine(["color", "--rgb", "300,0,0"]), CliError);
    assert.throws(() => parseCommandLine(["sync", "--unknown"]), CliError);
  });
});

describe("config", () => {
  it("accepts the example config shipped in the repository", () => {
    const url = new URL("../../../ambientlight.config.example.json", import.meta.url);
    const file = validateConfigFile(JSON.parse(fs.readFileSync(url, "utf8")), "example");
    assert.deepEqual(file.bulbs, ["192.168.1.50"]);
  });

  it("rejects unknown keys and out-of-range values", () => {
    assert.throws(() => validateConfigFile({ fpss: 10 }, "test"), /unknown option "fpss"/);
    assert.throws(() => validateConfigFile({ fps: 99 }, "test"), /between 1 and 30/);
    assert.throws(() => validateConfigFile({ calibration: { minDimming: 5 } }, "test"), /between 10 and 100/);
    assert.throws(() => validateConfigFile({ bulbs: "192.168.1.50" }, "test"), /array/);
  });

  it("merges defaults, then the config file, then flags", () => {
    const file = validateConfigFile(
      { bulbs: ["10.0.0.5"], fps: 8, screen: null, calibration: { gamma: 2 } },
      "test",
    );
    const config = resolveConfig(file, parseCommandLine(["sync", "--fps", "12", "--saturation", "1.1"]).flags);
    assert.deepEqual(config.bulbs, ["10.0.0.5"]);
    assert.equal(config.fps, 12);
    assert.equal(config.screen, undefined);
    assert.equal(config.calibration.gamma, 2);
    assert.equal(config.calibration.saturationBoost, 1.1);
    assert.equal(config.calibration.maxDimming, DEFAULT_CONFIG.calibration.maxDimming);
    assert.equal(config.restoreOnExit, true);
  });

  it("reads colorMode from the file and --color-mode, and rejects unknown modes", () => {
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).colorMode, "dominant");
    const file = validateConfigFile({ colorMode: "average" }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).colorMode, "average");
    assert.equal(resolveConfig(file, parseCommandLine(["sync", "--color-mode", "dominant"]).flags).colorMode, "dominant");
    assert.throws(() => validateConfigFile({ colorMode: "mean" }, "test"), /"dominant" or "average"/);
    assert.throws(() => resolveConfig(undefined, parseCommandLine(["sync", "--color-mode", "x"]).flags), /--color-mode/);
  });

  it("reads capture from the file and --capture, and rejects unknown backends", () => {
    const expected = process.platform === "win32" ? "gdi" : "screenshot-desktop";
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).capture, expected);
    const file = validateConfigFile({ capture: "screenshot-desktop" }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).capture, "screenshot-desktop");
    assert.equal(resolveConfig(file, parseCommandLine(["sync", "--capture", "gdi"]).flags).capture, "gdi");
    assert.throws(() => validateConfigFile({ capture: "dxgi" }, "test"), /"gdi" or "screenshot-desktop"/);
    assert.throws(() => resolveConfig(undefined, parseCommandLine(["sync", "--capture", "x"]).flags), /--capture/);
  });

  it("reads sceneCut from the file and --scene-cut, within 0-255", () => {
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).sceneCut, 40);
    const file = validateConfigFile({ sceneCut: 0 }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).sceneCut, 0);
    assert.equal(resolveConfig(file, parseCommandLine(["sync", "--scene-cut", "25"]).flags).sceneCut, 25);
    assert.throws(() => validateConfigFile({ sceneCut: 300 }, "test"), /between 0 and 255/);
  });

  it("reads paleWhite from the file and --pale-white, within 0-255", () => {
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).calibration.paleWhite, 140);
    const file = validateConfigFile({ calibration: { paleWhite: 0 } }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).calibration.paleWhite, 0);
    assert.equal(resolveConfig(file, parseCommandLine(["sync", "--pale-white", "90"]).flags).calibration.paleWhite, 90);
    assert.throws(() => validateConfigFile({ calibration: { paleWhite: 300 } }, "test"), /between 0 and 255/);
  });

  it("reads colorBaseBrightness from the file and --color-base, within 10-100 and maxDimming", () => {
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).calibration.colorBaseBrightness, 10);
    const file = validateConfigFile({ calibration: { colorBaseBrightness: 40 } }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).calibration.colorBaseBrightness, 40);
    const flags = parseCommandLine(["once", "--color-base", "70"]).flags;
    assert.equal(resolveConfig(file, flags).calibration.colorBaseBrightness, 70);
    assert.throws(() => validateConfigFile({ calibration: { colorBaseBrightness: 5 } }, "test"), /between 10 and 100/);
    assert.throws(() => resolveConfig(undefined, parseCommandLine(["sync", "--color-base", "101"]).flags), /--color-base/);
    assert.throws(() => resolveConfig(file, parseCommandLine(["sync", "--max-dimming", "30"]).flags), /cannot be higher/);
  });

  it("reads mutedGreenCorrection from the file and --muted-green, within 0-1", () => {
    assert.equal(resolveConfig(undefined, parseCommandLine(["sync"]).flags).calibration.mutedGreenCorrection, 1);
    const file = validateConfigFile({ calibration: { mutedGreenCorrection: 0.5 } }, "test");
    assert.equal(resolveConfig(file, parseCommandLine(["sync"]).flags).calibration.mutedGreenCorrection, 0.5);
    const flags = parseCommandLine(["sync", "--muted-green", "0"]).flags;
    assert.equal(resolveConfig(file, flags).calibration.mutedGreenCorrection, 0);
    assert.throws(() => validateConfigFile({ calibration: { mutedGreenCorrection: 2 } }, "test"), /between 0 and 1/);
    assert.throws(() => resolveConfig(undefined, parseCommandLine(["sync", "--muted-green", "-1"]).flags));
  });

  it("does not mutate the defaults", () => {
    resolveConfig({ calibration: { gamma: 3 } }, parseCommandLine(["sync"]).flags);
    assert.equal(DEFAULT_CONFIG.calibration.gamma, 1.6);
  });

  it("rejects minDimming above maxDimming", () => {
    assert.throws(
      () => resolveConfig(undefined, parseCommandLine(["sync", "--min-dimming", "80", "--max-dimming", "40"]).flags),
      /cannot be higher/,
    );
  });
});
