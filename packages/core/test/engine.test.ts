import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ColorSink, type PixelFrame, SyncEngine, type SyncOptions, type WizColor } from "../src/index.js";
import { FakeCapturer, FakeClock, RecordingSink, solidFrame } from "./helpers.js";

describe("SyncEngine", () => {
  it("sends the first frame, skips unchanged frames, and re-sends after keepAliveMs", async () => {
    const clock = new FakeClock();
    const sink = new RecordingSink();
    const engine = new SyncEngine(
      new FakeCapturer(solidFrame(255, 0, 0)),
      [sink],
      { smoothing: 1, keepAliveMs: 2000 },
      {},
      clock,
    );

    assert.equal((await engine.tick()).sent, true);
    clock.time = 100;
    assert.equal((await engine.tick()).sent, false);
    clock.time = 2100;
    assert.equal((await engine.tick()).sent, true);
    assert.deepEqual(sink.colors, [
      { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: 100 },
      { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: 100 },
    ]);
  });

  it("sends immediately when the color changes by at least minChange", async () => {
    const sink = new RecordingSink();
    const engine = new SyncEngine(
      new FakeCapturer(solidFrame(255, 0, 0), solidFrame(0, 0, 255)),
      [sink],
      { smoothing: 1, minChange: 4 },
      {},
      new FakeClock(),
    );
    await engine.tick();
    const second = await engine.tick();
    assert.equal(second.sent, true);
    assert.deepEqual(sink.colors.at(-1), { r: 0, g: 0, b: 255, c: 0, w: 0, dimming: 100 });
  });

  it("shows a gray screen with the white LEDs and switches back for colors", async () => {
    const sink = new RecordingSink();
    const engine = new SyncEngine(
      new FakeCapturer(solidFrame(240, 240, 240), solidFrame(255, 0, 0)),
      [sink],
      { smoothing: 1 },
      {},
      new FakeClock(),
    );
    const gray = await engine.tick();
    assert.equal(gray.output.temp, 5000);
    const red = await engine.tick();
    assert.equal(red.sent, true);
    assert.deepEqual(red.output, { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: 100 });
  });

  /** Output of the last frame when red is followed by `next`, ticking at the given times (ms). */
  const fadeFromRed = async (next: PixelFrame, times: number[], smoothing = 0.5): Promise<WizColor> => {
    const clock = new FakeClock();
    const options = { smoothing, calibration: { saturationBoost: 1, gamma: 1 } };
    const engine = new SyncEngine(new FakeCapturer(solidFrame(255, 0, 0), next), [], options, {}, clock);
    let output: WizColor | undefined;
    for (const time of times) {
      clock.time = time;
      output = (await engine.tick()).output;
    }
    assert.ok(output);
    return output;
  };

  it("smooths a small hue change over time, the same at any frame rate", async () => {
    const orange = solidFrame(255, 128, 0);
    const target = await fadeFromRed(orange, [0, 100], 1);
    const at10fps = await fadeFromRed(orange, [0, 100]);
    assert.ok(at10fps.g > 0 && at10fps.g < target.g, `partway from red to orange, got g=${at10fps.g}`);
    assert.deepEqual(await fadeFromRed(orange, [0, 50, 100]), at10fps, "20 FPS reaches the same color");
  });

  it("snaps instead of fading through a muddy color when the dominant hue jumps", async () => {
    const green = solidFrame(0, 255, 0);
    assert.deepEqual(await fadeFromRed(green, [0, 100]), await fadeFromRed(green, [0, 100], 1));
  });

  it("shows the dominant color of a multi-color screen and holds it on a near tie", async () => {
    /** A one-row frame: `red` red pixels, then `green` green ones. */
    const redGreen = (red: number, green: number): PixelFrame => ({
      data: Uint8Array.from([...Array<number[]>(red).fill([255, 0, 0]), ...Array<number[]>(green).fill([0, 255, 0])].flat()),
      width: red + green,
      height: 1,
      channels: 3,
    });
    const run = async (options: Partial<SyncOptions>): Promise<WizColor[]> => {
      const engine = new SyncEngine(new FakeCapturer(redGreen(8, 2), redGreen(5, 6)), [], { smoothing: 1, ...options });
      return [(await engine.tick()).output, (await engine.tick()).output];
    };

    const [first, second] = await run({});
    assert.deepEqual(first, { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: first?.dimming }, "red dominates, no olive mix");
    assert.deepEqual(second, { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: second?.dimming }, "a slightly bigger green area doesn't flip it");

    const [mixed] = await run({ colorMode: "average" });
    assert.ok(mixed !== undefined && mixed.g > 0, "average mode mixes red and green");
  });

  it("keeps sending to healthy bulbs when one fails, and reports the error", async () => {
    const errors: unknown[] = [];
    const healthy = new RecordingSink();
    const broken: ColorSink = { setColor: () => Promise.reject(new Error("unreachable")) };
    const engine = new SyncEngine(new FakeCapturer(solidFrame(0, 255, 0)), [broken, healthy], {}, {
      onError: (e) => errors.push(e),
    });
    await engine.tick();
    assert.equal(healthy.colors.length, 1);
    assert.equal(errors.length, 1);
  });

  it("runs continuously at the target rate and stops cleanly", async () => {
    const reports: unknown[] = [];
    const capturer = new FakeCapturer(solidFrame(10, 20, 30));
    const engine = new SyncEngine(capturer, [new RecordingSink()], { fps: 25 }, { onFrame: (r) => reports.push(r) });

    engine.start();
    assert.equal(engine.running, true);
    await new Promise((resolve) => setTimeout(resolve, 220));
    await engine.stop();
    assert.equal(engine.running, false);

    const framesAtStop = capturer.calls;
    assert.ok(framesAtStop >= 3 && framesAtStop <= 8, `expected ~5 frames at 25 FPS in 220 ms, got ${framesAtStop}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(capturer.calls, framesAtStop, "no frames after stop()");
    assert.equal(reports.length, framesAtStop);
  });

  it("clamps fps to a sane range", () => {
    assert.equal(new SyncEngine(new FakeCapturer(), [], { fps: 500 }).options.fps, 30);
    assert.equal(new SyncEngine(new FakeCapturer(), [], { fps: 0 }).options.fps, 1);
  });
});
