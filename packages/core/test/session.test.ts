import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type FrameReport, identifyBulb, type SessionState, SyncSession, WizLight } from "../src/index.js";
import { FakeCapturer, FakeSocket, solidFrame } from "./helpers.js";

const HOST = "192.168.1.50";

interface Sent {
  method: string;
  params: Record<string, unknown>;
}

const parse = (message: string): Sent => JSON.parse(message) as Sent;

/** A bulb that answers getPilot with `state` and acknowledges every setPilot. */
function answeringSocket(state: Record<string, unknown> = { state: true, temp: 2700, dimming: 60 }): FakeSocket {
  const socket = new FakeSocket();
  socket.responder = (d) => {
    const { method } = parse(d.message);
    const result = method === "getPilot" ? state : { success: true };
    return [{ address: d.address, text: JSON.stringify({ method, env: "pro", result }) }];
  };
  return socket;
}

function setPilots(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent.map((d) => parse(d.message)).filter((m) => m.method === "setPilot").map((m) => m.params);
}

function nextFrame(frames: FrameReport[], count: number): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (frames.length >= count) resolve();
      else setTimeout(check, 2);
    };
    check();
  });
}

describe("SyncSession", () => {
  it("reads the bulb, syncs, and restores the bulb on stop", async () => {
    const socket = answeringSocket();
    const frames: FrameReport[] = [];
    const states: SessionState[] = [];
    const session = new SyncSession(
      { capturer: new FakeCapturer(solidFrame(255, 0, 0)), lights: [new WizLight(HOST, socket)], sync: { fps: 30, smoothing: 1 } },
      { onFrame: (f) => frames.push(f), onState: (s) => states.push(s) },
    );

    await session.start();
    assert.equal(session.state, "running");
    await nextFrame(frames, 1);
    const result = await session.stop();

    assert.deepEqual(result.restored, [HOST]);
    assert.deepEqual(states, ["starting", "running", "stopping", "idle"]);
    const sent = setPilots(socket);
    assert.deepEqual(sent[0], { r: 255, g: 0, b: 0, c: 0, w: 0, dimming: 100 });
    assert.deepEqual(sent.at(-1), { state: true, dimming: 60, temp: 2700 });
  });

  it("keeps syncing a bulb whose state can't be read, and doesn't restore it", async () => {
    const socket = new FakeSocket();
    const unavailable: string[] = [];
    const frames: FrameReport[] = [];
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 20, retransmitAfterMs: 0 });
    const session = new SyncSession(
      { capturer: new FakeCapturer(solidFrame(0, 0, 255)), lights: [light], sync: { fps: 30, smoothing: 1 } },
      { onFrame: (f) => frames.push(f), onRestoreUnavailable: (host) => unavailable.push(host) },
    );

    await session.start();
    await nextFrame(frames, 1);
    assert.deepEqual(unavailable, [HOST]);
    assert.deepEqual(await session.stop(), { restored: [] });
    assert.ok(setPilots(socket).every((p) => p.b === 255));
  });

  it("applies new options while running without forgetting the saved state", async () => {
    const socket = answeringSocket();
    const frames: FrameReport[] = [];
    const session = new SyncSession(
      { capturer: new FakeCapturer(solidFrame(255, 0, 0)), lights: [new WizLight(HOST, socket)], sync: { fps: 30, smoothing: 1 } },
      { onFrame: (f) => frames.push(f) },
    );

    await session.start();
    await nextFrame(frames, 1);
    await session.update({ sync: { calibration: { maxDimming: 40 } } });
    assert.deepEqual(session.syncOptions.calibration, { maxDimming: 40 });
    const seen = frames.length;
    await nextFrame(frames, seen + 1);
    assert.equal(frames.at(-1)!.output.dimming, 40);

    await session.stop();
    assert.deepEqual(setPilots(socket).at(-1), { state: true, dimming: 60, temp: 2700 });
  });

  it("ignores a second start and a stop while idle", async () => {
    const socket = answeringSocket();
    const session = new SyncSession({ capturer: new FakeCapturer(solidFrame(9, 9, 9)), lights: [new WizLight(HOST, socket)] });
    assert.deepEqual(await session.stop(), { restored: [] });
    await Promise.all([session.start(), session.start()]);
    assert.equal(socket.sent.filter((d) => parse(d.message).method === "getPilot").length, 1);
    await session.stop();
    assert.equal(session.state, "idle");
  });

  it("can skip restoring", async () => {
    const socket = answeringSocket();
    const session = new SyncSession({
      capturer: new FakeCapturer(solidFrame(9, 9, 9)),
      lights: [new WizLight(HOST, socket)],
      restoreOnExit: false,
    });
    await session.start();
    assert.deepEqual(await session.stop(), { restored: [] });
    assert.ok(socket.sent.every((d) => parse(d.message).method !== "getPilot"));
  });
});

describe("identifyBulb", () => {
  it("flashes the bulb and puts its previous state back", async () => {
    const socket = answeringSocket({ state: true, r: 255, g: 120, b: 0, dimming: 40 });
    const result = await identifyBulb(new WizLight(HOST, socket), { flashes: 2, onMs: 0, offMs: 0 });

    assert.deepEqual(result, { host: HOST, restored: true });
    assert.deepEqual(setPilots(socket), [
      { state: true, temp: 6500, dimming: 100 },
      { state: false },
      { state: true, temp: 6500, dimming: 100 },
      { state: false },
      { state: true, dimming: 40, r: 255, g: 120, b: 0 },
    ]);
  });

  it("restores an off bulb to off", async () => {
    const socket = answeringSocket({ state: false });
    await identifyBulb(new WizLight(HOST, socket), { flashes: 1, onMs: 0, offMs: 0 });
    assert.deepEqual(setPilots(socket).at(-1), { state: false });
  });

  it("fails without touching the bulb when it doesn't answer", async () => {
    const socket = new FakeSocket();
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 20, retransmitAfterMs: 0 });
    await assert.rejects(identifyBulb(light, { onMs: 0, offMs: 0 }));
    assert.deepEqual(setPilots(socket), []);
  });
});
