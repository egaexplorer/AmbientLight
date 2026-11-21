import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ColorSink, SyncEngine } from "../src/index.js";
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
      { r: 255, g: 0, b: 0, dimming: 100 },
      { r: 255, g: 0, b: 0, dimming: 100 },
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
    assert.deepEqual(sink.colors.at(-1), { r: 0, g: 0, b: 255, dimming: 100 });
  });

  it("smooths transitions between frames", async () => {
    const sink = new RecordingSink();
    const engine = new SyncEngine(
      new FakeCapturer(solidFrame(255, 0, 0), solidFrame(0, 0, 255)),
      [sink],
      { smoothing: 0.5, calibration: { saturationBoost: 1, gamma: 1 } },
      {},
      new FakeClock(),
    );
    await engine.tick();
    const { output } = await engine.tick();
    assert.ok(output.r > 0 && output.b > 0, "halfway between red and blue should mix both");
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
