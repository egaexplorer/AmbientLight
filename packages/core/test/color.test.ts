import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeFrame,
  averageColor,
  calibrate,
  colorDistance,
  EmaSmoother,
  frameChange,
  hsvToRgb,
  paleColdShare,
  previewRgb,
  linearToSrgb,
  type PixelFrame,
  type Rgb,
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

describe("frameChange", () => {
  it("is 0 for identical frames and 255 between black and white", () => {
    assert.equal(frameChange(solidFrame(10, 20, 30), solidFrame(10, 20, 30)), 0);
    assert.equal(frameChange(solidFrame(0, 0, 0), solidFrame(255, 255, 255)), 255);
  });

  it("averages over the color channels and ignores the 4th byte of BGRA frames", () => {
    const bgra = (b: number, g: number, r: number, x: number): PixelFrame => ({
      data: Uint8Array.of(b, g, r, x, b, g, r, x),
      width: 2,
      height: 1,
      channels: 4,
      order: "bgr",
    });
    assert.equal(frameChange(bgra(0, 0, 90, 0), bgra(0, 0, 0, 255)), 30, "only red changed: 90 / 3 channels");
    const rgb: PixelFrame = { data: Uint8Array.of(90, 0, 0, 0, 90, 0, 0, 0), width: 2, height: 1, channels: 4 };
    assert.equal(frameChange(rgb, bgra(0, 0, 90, 0)), 0, "same colors in a different byte order");
  });

  it("gives 0 for frames of different sizes", () => {
    assert.equal(frameChange(solidFrame(0, 0, 0, 4, 2), solidFrame(255, 255, 255, 2, 2)), 0);
  });
});

describe("calibrate", () => {
  it("keeps a fully saturated bright color at full brightness", () => {
    assert.deepEqual(calibrate({ r: 255, g: 0, b: 0 }), { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: 100 });
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
    const out = calibrate(input, { gamma: 1, paleWhite: 0 });
    assert.ok(rgbToHsv(out).s > rgbToHsv(input).s);
  });

  it("always produces integer channels and WiZ-valid dimming", () => {
    for (let i = 0; i < 500; i++) {
      const out = calibrate({ r: (i * 37) % 256, g: (i * 91) % 256, b: (i * 53) % 256 });
      for (const ch of [out.r, out.g, out.b, out.c ?? 0, out.w ?? 0]) assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255);
      assert.ok(Number.isInteger(out.dimming) && out.dimming >= 10 && out.dimming <= 100);
    }
  });
});

describe("calibrate color base brightness", () => {
  const dimming = (color: Rgb, colorBaseBrightness?: number, brightness: Rgb = color): number =>
    calibrate(color, colorBaseBrightness === undefined ? {} : { colorBaseBrightness }, { brightness }).dimming;

  it("lifts dark colors (two movie shots measured on the user's screen)", () => {
    const lamps = [{ r: 27, g: 20, b: 16 }, { r: 23, g: 18, b: 16 }] as const; // hue source, screen average
    assert.equal(dimming(lamps[0], undefined, lamps[1]), 15, "off by default");
    assert.equal(dimming(lamps[0], 40, lamps[1]), 43);
    const doorway = { r: 32, g: 35, b: 25 };
    assert.equal(dimming(doorway), 19);
    assert.equal(dimming(doorway, 40), 46);
  });

  it("leaves black, near-black noise, gray and white screens alone", () => {
    const screens = [
      { r: 0, g: 0, b: 0 },
      { r: 6, g: 2, b: 2 },
      { r: 40, g: 40, b: 40 },
      { r: 244, g: 244, b: 244 },
    ];
    for (const screen of screens) assert.equal(dimming(screen, 70), dimming(screen), JSON.stringify(screen));
  });

  it("raises the bottom of the range, not the top", () => {
    const dark = { r: 35, g: 0, b: 0 };
    const full = { r: 255, g: 0, b: 0 };
    assert.ok(dimming(dark, 50) > dimming(dark) + 25);
    assert.equal(dimming(full, 50), 100);
  });

  it("never lowers minDimming or exceeds maxDimming", () => {
    const red = { r: 60, g: 0, b: 0 };
    assert.deepEqual(calibrate(red, { minDimming: 30, colorBaseBrightness: 20 }), calibrate(red, { minDimming: 30 }));
    assert.equal(calibrate(red, { maxDimming: 50, colorBaseBrightness: 90 }).dimming, 50);
  });

  it("still gets brighter with the screen, without a jump out of black", () => {
    let previous = dimming({ r: 0, g: 0, b: 0 }, 70);
    for (let v = 1; v <= 255; v++) {
      const next = dimming({ r: v, g: 0, b: 0 }, 70);
      assert.ok(next >= previous, `drops at v=${v}`);
      assert.ok(next - previous <= 8, `jumps at v=${v}: ${previous} -> ${next}`);
      previous = next;
    }
  });

  it("doesn't jump when white mode switches on or off", () => {
    for (const wasWhite of [false, true]) {
      let previous: number | undefined;
      for (let other = 128; other >= 80; other -= 0.5) {
        const color = { r: 128, g: other, b: other };
        const lifted = calibrate(color, { colorBaseBrightness: 70 }, { wasWhite });
        const plain = calibrate(color, {}, { wasWhite });
        if (lifted.temp !== undefined) assert.equal(lifted.dimming, plain.dimming, "no lift in white mode");
        if (previous !== undefined) assert.ok(Math.abs(lifted.dimming - previous) <= 2, `jumps at g=b=${other}`);
        previous = lifted.dimming;
      }
    }
  });
});

describe("calibrate muted greens", () => {
  const OFF = { mutedGreenCorrection: 0 };
  // The doorway shot measured on the user's screen: hue source and screen average.
  const doorway = { r: 33.32, g: 35.65, b: 25.07 };
  const brightness = { r: 32.21, g: 35.13, b: 24.82 };

  it("shows the doorway shot as the light picked on the bulb: its faint olive on cool white", () => {
    assert.deepEqual(calibrate(doorway, {}, { brightness }), { r: 73, g: 94, b: 0, c: 140, w: 0, dimming: 19 });
    assert.deepEqual(calibrate(doorway, OFF, { brightness }), { r: 120, g: 159, b: 0, c: 40, w: 88, dimming: 19 });
  });

  it("can be set in between", () => {
    const half = calibrate(doorway, { mutedGreenCorrection: 0.5 }, { brightness });
    assert.ok(half.g > 94 && half.g < 159, `g ${half.g}`);
    assert.ok(half.c !== undefined && half.c > 40 && half.c < 140, `c ${half.c}`);
  });

  it("still treats gamma 0 as no gamma", () => {
    const at = (gamma: number): unknown => calibrate(doorway, { gamma, mutedGreenCorrection: 0.5 }, { brightness });
    assert.deepEqual(at(0), at(1));
  });

  it("applies to similar dark and medium scenes", () => {
    const scenes = {
      "foggy forest": { r: 90, g: 105, b: 85 },
      "dim green-lit room": { r: 95, g: 115, b: 92 },
      "dark green tint": { r: 50, g: 72, b: 52 },
      "olive wall": { r: 85, g: 90, b: 60 },
    };
    for (const [name, color] of Object.entries(scenes)) assert.equal(calibrate(color).w, 0, name);
  });

  it("leaves other scenes as they were", () => {
    const scenes = {
      "orange lamp shot": { r: 26.91, g: 20.21, b: 16.44 },
      skin: { r: 200, g: 150, b: 130 },
      "olive skin": { r: 170, g: 140, b: 110 },
      beige: { r: 240, g: 225, b: 200 },
      sepia: { r: 112, g: 90, b: 70 },
      gold: { r: 220, g: 190, b: 40 },
      grass: { r: 90, g: 130, b: 50 },
      "vivid green": { r: 30, g: 200, b: 60 },
      "muted teal": { r: 70, g: 105, b: 105 },
      "pale blue": { r: 160, g: 190, b: 220 },
      navy: { r: 13, g: 17, b: 23 },
      gray: { r: 80, g: 80, b: 80 },
      "bright mint": { r: 150, g: 200, b: 175 },
      "mint page": { r: 215, g: 245, b: 220 },
      "pale yellow page": { r: 250, g: 250, b: 205 },
      "hazy meadow": { r: 170, g: 190, b: 140 },
    };
    for (const [name, color] of Object.entries(scenes)) assert.deepEqual(calibrate(color), calibrate(color, OFF), name);
  });

  it("never changes the brightness or which colors use white mode", () => {
    for (let h = 0; h < 360; h += 5) {
      for (let s = 0; s <= 1; s += 0.05) {
        for (const v of [0.05, 0.14, 0.3, 0.6, 0.9]) {
          for (const wasWhite of [false, true]) {
            const color = hsvToRgb({ h, s, v });
            const options = { colorBaseBrightness: 40 };
            const on = calibrate(color, options, { wasWhite });
            const off = calibrate(color, { ...options, ...OFF }, { wasWhite });
            assert.deepEqual([on.dimming, on.temp], [off.dimming, off.temp], `h=${h} s=${s} v=${v}`);
          }
        }
      }
    }
  });

  it("does nothing without the white LEDs (paleWhite 0)", () => {
    assert.deepEqual(calibrate(doorway, { paleWhite: 0 }), calibrate(doorway, { paleWhite: 0, ...OFF }));
  });

  it("fades in without steps", () => {
    const sweeps: Array<[name: string, from: number, to: number, inc: number, color: (x: number) => Rgb]> = [
      ["hue", 30, 190, 1, (h) => hsvToRgb({ h, s: 0.28, v: 0.3 })],
      ["saturation", 0.17, 0.7, 0.01, (s) => hsvToRgb({ h: 78, s, v: 0.3 })],
      ["brightness", 0.1, 0.9, 0.01, (v) => hsvToRgb({ h: 78, s: 0.28, v })],
    ];
    for (const [name, from, to, inc, color] of sweeps) {
      let previous = calibrate(color(from));
      for (let x = from + inc; x <= to; x += inc) {
        const out = calibrate(color(x));
        for (const key of ["r", "g", "b", "c", "w"] as const) {
          const step = Math.abs((out[key] ?? 0) - (previous[key] ?? 0));
          assert.ok(step <= 16, `${name} ${x}: ${key} steps by ${step}`);
        }
        previous = out;
      }
    }
  });
});

describe("calibrate pale colors (hue + white LEDs, like the WiZ app)", () => {
  /** What the WiZ app sent for colors picked in it, read back with `npm run state` (ESP25_SHRGB_01, fw 1.38.0). */
  const APP_READINGS: Array<[hex: string, sent: { r: number; g: number; b: number; c: number; w: number }]> = [
    ["#ffffff", { r: 26, g: 0, b: 0, c: 0, w: 140 }],
    ["#ffc0c0", { r: 82, g: 0, b: 0, c: 0, w: 140 }],
    ["#ffbc85", { r: 135, g: 61, b: 0, c: 16, w: 124 }],
    ["#ff8080", { r: 140, g: 0, b: 0, c: 0, w: 140 }],
    ["#85ff9c", { r: 0, g: 135, b: 26, c: 77, w: 63 }],
    ["#85bcff", { r: 0, g: 61, b: 135, c: 124, w: 16 }],
    ["#c085ff", { r: 65, g: 0, b: 135, c: 106, w: 34 }],
    ["#ff85d0", { r: 135, g: 0, b: 83, c: 43, w: 97 }],
    ["#ff4040", { r: 255, g: 0, b: 0, c: 0, w: 70 }],
    ["#ff2020", { r: 255, g: 0, b: 0, c: 0, w: 35 }],
    ["#ff0000", { r: 255, g: 0, b: 0, c: 0, w: 0 }],
  ];
  const hex = (h: string): { r: number; g: number; b: number } => ({
    r: Number.parseInt(h.slice(1, 3), 16),
    g: Number.parseInt(h.slice(3, 5), 16),
    b: Number.parseInt(h.slice(5, 7), 16),
  });
  /** No boost, gamma, white mode or correction: the color goes to the encoder exactly as picked in the app. */
  const AS_IS = { gamma: 1, saturationBoost: 1, whiteSaturation: 0, mutedGreenCorrection: 0 };

  for (const [color, sent] of APP_READINGS) {
    it(`sends ${color} the way the WiZ app does`, () => {
      const out = calibrate(hex(color), AS_IS);
      for (const key of ["r", "g", "b", "c", "w"] as const) near(out[key] ?? -1, sent[key], 1);
    });
  }

  it("tints the white by hue: warm for red, cold for blue, back to warm through purple", () => {
    near(paleColdShare(0), 0, 0);
    near(paleColdShare(120), 0.5, 0);
    near(paleColdShare(240), 1, 0);
    near(paleColdShare(300), 0.5, 0);
    near(paleColdShare(360), 0, 0);
  });

  it("changes smoothly between s = 0.5 and 0.75, where the app was not measured", () => {
    let previous = calibrate({ r: 255, g: 128, b: 128 }, AS_IS);
    for (let low = 127; low >= 60; low--) {
      const out = calibrate({ r: 255, g: low, b: low }, AS_IS);
      assert.ok(Math.abs(out.r - previous.r) <= 8, `hue level jumps at g=b=${low}`);
      assert.ok(Math.abs((out.w ?? 0) - (previous.w ?? 0)) <= 3, `white jumps at g=b=${low}`);
      previous = out;
    }
  });

  it("keeps the old RGB-only mix with paleWhite 0", () => {
    const out = calibrate({ r: 130, g: 112, b: 96 }, { paleWhite: 0 });
    assert.equal(out.c, undefined);
    assert.equal(out.w, undefined);
    near(out.r, 255, 0);
    near(out.g, 188, 3);
    near(out.b, 133, 3);
  });

  it("lets previewRgb recover the intended color for logs", () => {
    for (const input of [{ r: 130, g: 112, b: 96 }, { r: 255, g: 60, b: 60 }, { r: 40, g: 90, b: 200 }, { r: 0, g: 255, b: 0 }]) {
      const intended = calibrate(input, { paleWhite: 0 });
      const preview = previewRgb(calibrate(input));
      near(preview.r, intended.r, 4);
      near(preview.g, intended.g, 4);
      near(preview.b, intended.b, 4);
    }
    for (const [color] of APP_READINGS.slice(1)) {
      const preview = previewRgb(calibrate(hex(color), AS_IS));
      const target = hex(color);
      near(preview.r, target.r, 4);
      near(preview.g, target.g, 4);
      near(preview.b, target.b, 4);
    }
  });
});

describe("calibrate white mode", () => {
  it("sends near-gray colors to the white LEDs instead of mixing white from RGB", () => {
    const out = calibrate({ r: 248, g: 247, b: 248 });
    assert.equal(out.temp, 5000);
    assert.ok(out.dimming > 90);
    assert.equal(calibrate({ r: 200, g: 200, b: 200 }, { whiteTemp: 2700 }).temp, 2700);
  });

  it("can be turned off with whiteSaturation 0", () => {
    const out = calibrate({ r: 248, g: 247, b: 248 }, { whiteSaturation: 0 });
    assert.equal(out.temp, undefined);
    assert.equal((out.c ?? 0) + (out.w ?? 0), 140, "near-white still comes from the white LEDs, through c and w");
    assert.equal(calibrate({ r: 248, g: 247, b: 248 }, { whiteSaturation: 0, paleWhite: 0 }).r, 255);
  });

  it("keeps clearly colored scenes in RGB", () => {
    assert.equal(calibrate({ r: 200, g: 150, b: 150 }).temp, undefined);
  });

  it("uses hysteresis so a color near the threshold doesn't flip modes", () => {
    // Saturation 0.13 × boost 1.3 ≈ 0.17: above the 0.15 threshold, below 0.15 + hysteresis.
    const borderline = { r: 255, g: 222, b: 222 };
    assert.equal(calibrate(borderline).temp, undefined, "entering white needs < 0.15");
    assert.equal(calibrate(borderline, {}, { wasWhite: true }).temp, 5000, "leaving white needs > 0.20");
  });

  it("takes dimming from the brightness color when given", () => {
    const vivid = { r: 255, g: 0, b: 0 };
    const out = calibrate(vivid, {}, { brightness: { r: 40, g: 40, b: 40 } });
    assert.deepEqual([out.r, out.g, out.b], [255, 0, 0]);
    assert.ok(out.dimming < calibrate(vivid).dimming);
  });
});

describe("analyzeFrame", () => {
  /** A frame of `width` pixels: the first `colored` are (r,g,b), the rest white. */
  function mixed(colored: number, width: number, [r, g, b]: [number, number, number]): PixelFrame {
    const data = new Uint8Array(width * 3).fill(255);
    for (let i = 0; i < colored; i++) data.set([r, g, b], i * 3);
    return { data, width, height: 1, channels: 3 };
  }

  it("matches averageColor when colorWeighting is 0", () => {
    const frame = mixed(3, 10, [255, 0, 0]);
    const { average, color } = analyzeFrame(frame, { colorWeighting: 0 });
    assert.deepEqual(color, average);
    assert.deepEqual(average, averageColor(frame));
  });

  it("lets a colorful area set the hue when it covers part of the screen", () => {
    const { average, color } = analyzeFrame(mixed(2, 10, [255, 0, 0]), { colorWeighting: 0.6 });
    assert.ok(rgbToHsv(color).s > rgbToHsv(average).s * 2, "weighted color is much more saturated");
    assert.equal(calibrate(color).temp, undefined, "20 % red shows as a color");
    assert.equal(calibrate(average).temp, 5000, "the plain average would have been white");
  });

  it("keeps a small colorful detail on a white page close to white", () => {
    const { color } = analyzeFrame(mixed(1, 50, [255, 0, 0]), { colorWeighting: 0.6 });
    assert.equal(calibrate(color).temp, 5000);
  });

  it("gives dark colors much less weight than bright ones", () => {
    const dark = analyzeFrame(mixed(5, 10, [40, 0, 0]), { colorWeighting: 1 });
    const bright = analyzeFrame(mixed(5, 10, [255, 0, 0]), { colorWeighting: 1 });
    near(dark.color.g, dark.average.g, 10);
    assert.ok(bright.average.g - bright.color.g > 60, "bright red pulls the color strongly");
  });
});

describe("analyzeFrame dominant color", () => {
  type Px = [number, number, number];
  /** A one-row frame made of `count` pixels of each color, in order. */
  function strip(...parts: Array<[count: number, color: Px]>): PixelFrame {
    const pixels = parts.flatMap(([count, color]) => Array.from({ length: count }, () => color));
    return { data: Uint8Array.from(pixels.flat()), width: pixels.length, height: 1, channels: 3 };
  }
  const RED: Px = [255, 0, 0];
  const GREEN: Px = [0, 255, 0];
  const BLUE: Px = [0, 0, 255];
  const WHITE: Px = [255, 255, 255];

  it("picks the strongest color instead of mixing distant hues", () => {
    const frame = strip([6, RED], [4, GREEN]);
    const mixedHue = rgbToHsv(analyzeFrame(frame, { colorWeighting: 0.6, colorMode: "average" }).color).h;
    assert.ok(mixedHue > 30 && mixedHue < 90, `averaging red and green gives yellow/olive (hue ${mixedHue})`);

    const { color, hue } = analyzeFrame(frame, { colorWeighting: 0.6 });
    near(color.r, 255);
    near(color.g, 0);
    near(hue ?? -1, 0);
  });

  it("counts area and vividness when voting", () => {
    // 3 bright blue pixels outvote 5 dull, dark red ones.
    const { hue } = analyzeFrame(strip([5, [90, 40, 40]], [3, BLUE]));
    near(hue ?? -1, 240);
  });

  it("keeps close hues together, so red and orange blend", () => {
    const { hue } = analyzeFrame(strip([5, RED], [5, [255, 128, 0]], [3, BLUE]));
    assert.ok(hue !== undefined && hue > 5 && hue < 30, `expected a red-orange hue, got ${hue}`);
  });

  it("treats hues on both sides of 0° as one family", () => {
    const { color, hue } = analyzeFrame(strip([3, [255, 0, 40]], [3, [255, 40, 0]], [4, BLUE]));
    assert.ok(hue !== undefined && (hue < 10 || hue > 350), `expected red, got ${hue}`);
    assert.ok(color.b < 100, "the blue pixels are left out");
  });

  it("still lets white areas wash the color out, so a small detail on a white page stays white", () => {
    const { color } = analyzeFrame(strip([1, RED], [1, GREEN], [48, WHITE]), { colorWeighting: 0.6 });
    assert.equal(calibrate(color).temp, 5000);
  });

  it("returns the plain weighted color and no hue when nothing is colorful", () => {
    const frame = strip([4, [200, 200, 200]], [4, [20, 20, 20]]);
    const { color, average, hue } = analyzeFrame(frame);
    assert.equal(hue, undefined);
    assert.deepEqual(color, average);
  });

  it("keeps the previous hue on a near tie, and switches when another color clearly wins", () => {
    const tie = strip([5, RED], [6, GREEN]);
    near(analyzeFrame(tie).hue ?? -1, 120);
    near(analyzeFrame(tie, { preferHue: 0 }).hue ?? -1, 0);
    near(analyzeFrame(strip([5, RED], [8, GREEN]), { preferHue: 0 }).hue ?? -1, 120);
  });
});

describe("smoothing", () => {
  it("passes the first sample through and then moves toward new samples", () => {
    const ema = new EmaSmoother(0.5);
    assert.deepEqual(ema.next({ r: 0, g: 0, b: 0 }), { r: 0, g: 0, b: 0 });
    assert.deepEqual(ema.next({ r: 100, g: 200, b: 50 }), { r: 50, g: 100, b: 25 });
    assert.deepEqual(ema.next({ r: 100, g: 200, b: 50 }), { r: 75, g: 150, b: 37.5 });
  });

  it("is time-based: two 50 ms steps land where one 100 ms step does", () => {
    const once = new EmaSmoother(0.5);
    once.next({ r: 0, g: 0, b: 0 });
    const twice = new EmaSmoother(0.5);
    twice.next({ r: 0, g: 0, b: 0 });
    twice.next({ r: 100, g: 200, b: 50 }, 50);
    const a = once.next({ r: 100, g: 200, b: 50 }, 100);
    const b = twice.next({ r: 100, g: 200, b: 50 }, 50);
    for (const k of ["r", "g", "b"] as const) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} vs ${b[k]}`);
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

  it("treats switching between white mode and RGB as a change", () => {
    const white = { r: 255, g: 255, b: 255, dimming: 50, temp: 4000 };
    assert.equal(colorDistance(white, { r: 255, g: 255, b: 255, dimming: 50 }), Number.POSITIVE_INFINITY);
    assert.equal(colorDistance(white, { ...white, temp: 2700 }), Number.POSITIVE_INFINITY);
    assert.equal(colorDistance(white, { ...white, dimming: 52 }), 5.1);
  });
});
