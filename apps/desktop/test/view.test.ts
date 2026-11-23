import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FrameReport } from "@ambientlight/core";
import { UserError } from "@ambientlight/node";
import { bulbPreview, frameLogLine, FrameViews, kelvinToRgb, toHex } from "../src/main/frame-view.js";
import { checkBulbList, checkIp, checkLook, checkTitleKind } from "../src/main/validate.js";
import { statsText, titleErrorText } from "../src/renderer/src/model/format.js";
import { lookChips } from "../src/renderer/src/model/looks.js";

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

  it("accepts known looks and title kinds only", () => {
    assert.deepEqual(checkLook({ name: "horror", title: "X", extra: 1 }), { name: "horror", title: "X" });
    assert.equal(checkLook(null), null);
    assert.throws(() => checkLook({ name: "gore" }), UserError);
    assert.throws(() => checkTitleKind("book"), UserError);
  });
});

describe("renderer text", () => {
  it("words lookup failures for the app instead of the CLI", () => {
    const text = titleErrorText("film", "Dune ", { ok: false, code: "not-found", message: "", similar: ["Dune Part Two"] });
    assert.match(text, /No film called “Dune” found\. Close: “Dune Part Two”\./);
    assert.doesNotMatch(text, /--/);
    assert.match(titleErrorText("series", "x", { ok: false, code: "rate-limited", message: "", similar: [], retryAfterS: 7 }), /TVmaze .* 7 s/);
  });

  it("describes the live numbers and every look", () => {
    assert.equal(
      statsText({ screen: "", hue: "", bulb: "", bulbText: "", fps: 20, captureMs: 32, sentShare: 0.14, cut: false }),
      "20.0 fps · capture 32 ms · 14 % of frames sent",
    );
    const chips = lookChips();
    assert.equal(chips.length, 9);
    assert.deepEqual(chips[1], { name: "horror", label: "Horror", detail: "Up to 45 % · 6500 K · pale, dim" });
  });
});
