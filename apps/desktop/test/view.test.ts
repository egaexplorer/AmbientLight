import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FrameReport } from "@ambientlight/core";
import { UserError } from "@ambientlight/node";
import { bulbPreview, frameLogLine, FrameViews, kelvinToRgb, toHex } from "../src/main/frame-view.js";
import { checkBrightness, checkBulbList, checkIp, checkLook, checkTitleKind } from "../src/main/validate.js";
import { brightnessText, macText, statsText, titleErrorText } from "../src/renderer/src/model/format.js";
import { gameLookChips, lookChips, lookLabel, lookOf, sameLook, tuningText } from "../src/renderer/src/model/looks.js";

function report(sent: boolean, captureMs = 31.6): FrameReport {
  return {
    average: { r: 23, g: 18, b: 16 },
    color: { r: 176, g: 90, b: 42 },
    output: { r: 255, g: 122, b: 46, c: 0, w: 0, dimming: 15 },
    sent,
    cut: false,
    captureMs,
    totalMs: captureMs + 0.4,
  };
}

describe("frame views", () => {
  it("draws white LEDs at their temperature and colors as the bulb mixes them", () => {
    assert.equal(toHex({ r: 23, g: 18, b: 16 }), "#171210");
    const warm = kelvinToRgb(2700);
    assert.ok(warm.r === 255 && warm.b < warm.g);
    const daylight = kelvinToRgb(6500);
    assert.ok(daylight.r > 250 && daylight.g > 245 && daylight.b > 240);
    assert.deepEqual(bulbPreview({ r: 255, g: 255, b: 255, temp: 5000, dimming: 40 }, 140).text, "white 5000 K · dim 40 %");
    assert.deepEqual(bulbPreview({ r: 255, g: 122, b: 46, c: 0, w: 0, dimming: 15 }, 140), { color: "#ff7a2e", text: "dim 15 %" });
  });

  it("lets one view through per interval and counts fps and frames sent", () => {
    let now = 0;
    const views = new FrameViews(() => now, 140, 100);
    const first = views.next(report(true));
    assert.equal(first?.screen, "#171210");
    assert.equal(first?.captureMs, 32);
    for (let i = 1; i < 20; i++) {
      now = i * 50;
      views.next(report(i % 2 === 0));
    }
    now = 1000;
    const last = views.next(report(false));
    assert.equal(last?.fps, 20);
    assert.equal(last?.sentShare, 10 / 21);
    now = 1050;
    assert.equal(views.next(report(false)), undefined);
  });

  it("shows the mean capture time of the frames since the last view, not just the view's own frame", () => {
    let now = 0;
    const views = new FrameViews(() => now, 140, 100);
    views.next(report(true, 30));
    now = 50;
    views.next(report(true, 20));
    now = 100;
    assert.equal(views.next(report(true, 40))?.captureMs, 30);
    now = 200;
    assert.equal(views.next(report(true, 24))?.captureMs, 24);
  });

  it("logs a frame with the fields npm run state prints", () => {
    assert.equal(frameLogLine(report(true, 25.27)), "r 255  g 122  b 46  c 0  w 0  dim 15% | capture 25.3 ms | sent");
    const white = { ...report(false), output: { r: 255, g: 255, b: 255, temp: 5000, dimming: 57 } };
    assert.equal(frameLogLine(white), "temp 5000 K  dim 57% | capture 31.6 ms");
  });
});

describe("IPC input checks", () => {
  it("accepts IPv4 addresses only, and at most 16 distinct bulbs", () => {
    assert.equal(checkIp(" 192.168.1.50 "), "192.168.1.50");
    assert.throws(() => checkIp("192.168.1.256"), UserError);
    assert.throws(() => checkIp("bulb.local"), UserError);
    assert.deepEqual(checkBulbList(["10.0.0.2", "10.0.0.2"]), ["10.0.0.2"]);
    assert.throws(() => checkBulbList(Array.from({ length: 17 }, (_, i) => `10.0.0.${i}`)), /16/);
  });

  it("accepts a whole brightness from 10 to 100 only", () => {
    assert.equal(checkBrightness(10), 10);
    assert.equal(checkBrightness(100), 100);
    for (const bad of [9, 101, 50.5, "70", null]) assert.throws(() => checkBrightness(bad), UserError);
  });

  it("accepts known looks and title kinds only", () => {
    assert.deepEqual(checkLook({ set: "film", name: "horror", title: "X", extra: 1 }), { set: "film", name: "horror", title: "X" });
    assert.deepEqual(checkLook({ set: "game", name: "shooter" }), { set: "game", name: "shooter" });
    // A tuning only comes from a lookup in the main process; a picked look is the plain genre look.
    const tuning = { brightness: 2, warmth: 2, vividness: 2, reason: "r", by: "AI" };
    assert.deepEqual(checkLook({ set: "film", name: "horror", tuning, aiError: "x" }), { set: "film", name: "horror" });
    assert.equal(checkLook(null), null);
    assert.throws(() => checkLook({ set: "film", name: "gore" }), UserError);
    assert.throws(() => checkLook({ name: "horror" }), UserError);
    assert.throws(() => checkLook({ set: "game", name: "thriller" }), UserError);
    assert.throws(() => checkLook({ set: "film", name: "shooter" }), UserError);
    assert.equal(checkTitleKind("game"), "game");
    assert.throws(() => checkTitleKind("book"), UserError);
  });
});

describe("renderer text", () => {
  it("shows the brightness setting with the top brightness it gives", () => {
    assert.equal(brightnessText(100, 64), "100 % · bulb up to 64 %");
  });

  it("writes a bulb's MAC in pairs", () => {
    assert.equal(macText("9877D56C94FE"), "98:77:d5:6c:94:fe");
    assert.equal(macText(undefined), "—");
    assert.equal(macText("not-a-mac"), "not-a-mac");
  });

  it("words lookup failures for the app instead of the CLI", () => {
    const text = titleErrorText("film", "Dune ", { ok: false, code: "not-found", message: "", similar: ["Dune Part Two"] });
    assert.match(text, /No film called “Dune” found\. Close: “Dune Part Two”\./);
    assert.doesNotMatch(text, /--/);
    assert.match(titleErrorText("series", "x", { ok: false, code: "rate-limited", message: "", similar: [], retryAfterS: 7 }), /TVmaze .* 7 s/);
    const game = titleErrorText("game", "Doom", { ok: false, code: "not-found", message: "", similar: [] });
    assert.match(game, /No game called “Doom” found\. .*“Doom \(2016\)”, or pick a look below\./);
    assert.match(titleErrorText("game", "x", { ok: false, code: "offline", message: "", similar: [] }), /Wikipedia/);
  });

  it("describes the live numbers and every look", () => {
    assert.equal(
      statsText({ screen: "", hue: "", bulb: "", bulbText: "", fps: 20, captureMs: 32, sentShare: 0.14, cut: false }),
      "20.0 fps · capture 32 ms · 14 % of frames sent",
    );
    const chips = lookChips();
    assert.equal(chips.length, 9);
    assert.deepEqual(chips[1], { look: { set: "film", name: "horror" }, label: "Horror", detail: "Up to 45 % · 6500 K · pale, dim" });
    const games = gameLookChips();
    assert.equal(games.length, 8);
    assert.deepEqual(games[0]!.look, null);
    assert.deepEqual(games.find((chip) => chip.look?.name === "shooter"), {
      look: { set: "game", name: "shooter" },
      label: "Shooter & fighting",
      detail: "Fast · up to 100 % · leans red-orange",
    });
    assert.equal(lookLabel({ set: "game", name: "cozy" }), "Cozy");
    assert.ok(sameLook({ set: "game", name: "horror", title: "DreadOut" }, { set: "game", name: "horror" }));
    assert.ok(!sameLook({ set: "game", name: "horror" }, { set: "film", name: "horror" }));
    assert.ok(sameLook(null, null) && !sameLook(null, { set: "film", name: "drama" }));
  });

  it("shows what the AI changed", () => {
    const tuning = { brightness: 1, warmth: 0, vividness: -2, reason: "r", by: "AI" } as const;
    assert.equal(tuningText(tuning), "Brighter, much softer");
    assert.equal(tuningText({ ...tuning, brightness: 0, vividness: 0 }), "No change");
    assert.equal(lookOf({ set: "film", name: "horror", tuning }).maxDimming, 55);
    assert.ok(sameLook({ set: "film", name: "horror", tuning }, { set: "film", name: "horror" }));
  });
});
