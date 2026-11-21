import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  averageColor,
  calibrate,
  colorDistance,
  EmaSmoother,
  hsvToRgb,
  linearToSrgb,
  type PixelFrame,
  rgbToHsv,
  srgbToLinear,
} from "../src/index.js";
import { solidFrame } from "./helpers.js";

function near(actual: number, expected: number, tolerance = 0.6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

describe("color conversion", () => {
  it("round-trips RGB through HSV", () => {
    for (const rgb of [
      { r: 255, g: 0, b: 0 },
      { r: 12, g: 200, b: 99 },
      { r: 128, g: 128, b: 128 },
      { r: 40, g: 10, b: 230 },
    ]) {
      const back = hsvToRgb(rgbToHsv(rgb));
      near(back.r, rgb.r);
      near(back.g, rgb.g);
      near(back.b, rgb.b);
    }
  });

  it("round-trips sRGB through linear light", () => {
    for (let v = 0; v <= 255; v += 17) near(linearToSrgb(srgbToLinear(v)), v, 0.01);
  });
});

describe("averageColor", () => {
  it("returns the color of a solid frame", () => {
    const avg = averageColor(solidFrame(200, 100, 50));
    near(avg.r, 200);
    near(avg.g, 100);
    near(avg.b, 50);
  });

  it("averages in linear light (half black + half white ≈ 188, not 128)", () => {
    const frame: PixelFrame = { data: Uint8Array.from([0, 0, 0, 255, 255, 255]), width: 2, height: 1, channels: 3 };
    near(averageColor(frame).r, 188, 1);
  });

  it("ignores the alpha byte of RGBA frames", () => {
    const frame: PixelFrame = { data: Uint8Array.from([10, 20, 30, 0, 10, 20, 30, 255]), width: 2, height: 1, channels: 4 };
    const avg = averageColor(frame);
    near(avg.r, 10);
    near(avg.g, 20);
    near(avg.b, 30);
  });

  it("supports BGR(A) byte order", () => {
    const frame: PixelFrame = { data: Uint8Array.from([255, 0, 0, 255]), width: 1, height: 1, channels: 4, order: "bgr" };
    const avg = averageColor(frame);
    near(avg.r, 0);
    near(avg.b, 255);
  });

  it("samples every Nth pixel when step > 1", () => {
    const frame: PixelFrame = {
      data: Uint8Array.from([255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]),
      width: 4,
      height: 1,
      channels: 3,
    };
    const avg = averageColor(frame, { step: 2 });
    near(avg.r, 255);
    near(avg.b, 0);
  });

  it("rejects a buffer that is smaller than width × height × channels", () => {
    assert.throws(() => averageColor({ data: new Uint8Array(5), width: 2, height: 1, channels: 3 }), RangeError);
  });
});

describe("calibrate", () => {
  it("keeps a fully saturated bright color at full brightness", () => {
    assert.deepEqual(calibrate({ r: 255, g: 0, b: 0 }), { r: 255, g: 0, b: 0, dimming: 100 });
  });

  it("holds black at the minimum dimming", () => {
    assert.equal(calibrate({ r: 0, g: 0, b: 0 }).dimming, 10);
    assert.equal(calibrate({ r: 3, g: 3, b: 3 }, { minDimming: 30 }).dimming, 30);
  });

  it("separates hue from brightness: a dark red is still pure red, just dimmer", () => {
    const out = calibrate({ r: 100, g: 0, b: 0 });
    assert.deepEqual([out.r, out.g, out.b], [255, 0, 0]);
    assert.ok(out.dimming > 10 && out.dimming < 100);
  });

  it("makes dimming increase with screen brightness", () => {
    let previous = 0;
    for (let v = 0; v <= 255; v += 15) {
      const { dimming } = calibrate({ r: v, g: v, b: v });
      assert.ok(dimming >= previous, `dimming should not drop (v=${v})`);
      previous = dimming;
    }
  });

  it("boosts the saturation of washed-out averages", () => {
    const input = { r: 200, g: 150, b: 150 };
    const out = calibrate(input, { gamma: 1 });
    assert.ok(rgbToHsv(out).s > rgbToHsv(input).s);
  });

  it("always produces integer channels and WiZ-valid dimming", () => {
    for (let i = 0; i < 500; i++) {
      const out = calibrate({ r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256 });
      for (const ch of [out.r, out.g, out.b]) assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255);
      assert.ok(Number.isInteger(out.dimming) && out.dimming >= 10 && out.dimming <= 100);
    }
  });
});

describe("smoothing", () => {
  it("passes the first sample through and then moves toward new samples", () => {
    const ema = new EmaSmoother(0.5);
    assert.deepEqual(ema.next({ r: 0, g: 0, b: 0 }), { r: 0, g: 0, b: 0 });
    assert.deepEqual(ema.next({ r: 100, g: 200, b: 50 }), { r: 50, g: 100, b: 25 });
    assert.deepEqual(ema.next({ r: 100, g: 200, b: 50 }), { r: 75, g: 150, b: 37.5 });
  });

  it("does not smooth when alpha is 1", () => {
    const ema = new EmaSmoother(1);
    ema.next({ r: 0, g: 0, b: 0 });
    assert.deepEqual(ema.next({ r: 9, g: 8, b: 7 }), { r: 9, g: 8, b: 7 });
  });

  it("measures the largest channel or dimming change", () => {
    assert.equal(colorDistance({ r: 10, g: 10, b: 10, dimming: 50 }, { r: 13, g: 10, b: 10, dimming: 50 }), 3);
    assert.equal(colorDistance({ r: 0, g: 0, b: 0, dimming: 50 }, { r: 0, g: 0, b: 0, dimming: 52 }), 5.1);
  });
});
