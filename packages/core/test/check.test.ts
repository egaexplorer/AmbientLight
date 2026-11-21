import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkBulb, WizLight } from "../src/index.js";
import { FakeSocket, type SentDatagram } from "./helpers.js";

const HOST = "192.168.1.50";

/** A fake bulb: answers each method with the given JSON reply (minus `method`), or stays silent. */
function bulb(replies: Record<string, object | undefined>): FakeSocket {
  const socket = new FakeSocket();
  socket.responder = (d: SentDatagram) => {
    const { method } = JSON.parse(d.message) as { method: string };
    const reply = replies[method];
    return reply ? [{ address: HOST, text: JSON.stringify({ method, env: "pro", ...reply }) }] : [];
  };
  return socket;
}

const PILOT = { result: { mac: "a8bb50aabbcc", rssi: -58, state: true, sceneId: 0, temp: 2700, dimming: 70 } };
const COLOR_BULB = { result: { mac: "a8bb50aabbcc", moduleName: "ESP25_SHRGB_01", fwVersion: "1.31.0" } };
const ACK = { result: { success: true } };
const NOT_FOUND = { error: { code: -32601, message: "Method not found" } };

function setPilots(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.sent
    .map((d) => JSON.parse(d.message) as { method: string; params: Record<string, unknown> })
    .filter((m) => m.method === "setPilot")
    .map((m) => m.params);
}

describe("checkBulb", () => {
  it("reports a color bulb that accepts commands as ready, and restores its state", async () => {
    const socket = bulb({ getPilot: PILOT, getSystemConfig: COLOR_BULB, getModelConfig: NOT_FOUND, setPilot: ACK });
    const report = await checkBulb(new WizLight(HOST, socket), { holdMs: 0 });

    assert.equal(report.verdict, "ready");
    assert.equal(report.kind, "color");
    assert.equal(report.system?.fwVersion, "1.31.0");
    assert.equal(report.signed, false);
    assert.equal(report.minDimming, 10);
    assert.match(report.modelError ?? "", /Method not found/);
    assert.deepEqual(report.test, { status: "accepted" });
    assert.equal(report.restore, "restored");
    assert.deepEqual(setPilots(socket), [
      { state: true, r: 255, g: 0, b: 0, dimming: 100 },
      { state: true, dimming: 70, temp: 2700 },
    ]);
  });

  it("uses the bulb's minDimLevel when reported", async () => {
    const socket = bulb({
      getPilot: PILOT,
      getSystemConfig: COLOR_BULB,
      getModelConfig: { result: { minDimLevel: 5 } },
      setPilot: ACK,
    });
    const report = await checkBulb(new WizLight(HOST, socket), { holdMs: 0 });
    assert.equal(report.minDimming, 5);
  });

  it("detects firmware that requires signed commands and leaves the bulb alone", async () => {
    const socket = bulb({
      getPilot: { ...PILOT, hmac: "c2lnbmVk" },
      getSystemConfig: { ...COLOR_BULB, hmac: "c2lnbmVk" },
      getModelConfig: NOT_FOUND,
      setPilot: { error: { code: -32602, message: "Invalid params" }, hmac: "c2lnbmVk" },
    });
    const report = await checkBulb(new WizLight(HOST, socket), { holdMs: 0 });

    assert.equal(report.verdict, "needs-signing");
    assert.equal(report.signed, true);
    assert.deepEqual(report.test, { status: "rejected", code: -32602, message: "Invalid params" });
    assert.equal(report.restore, "not-needed");
    assert.equal(setPilots(socket).length, 1, "no restore after a rejected command");
  });

  it("flags white-only bulbs", async () => {
    const socket = bulb({
      getPilot: PILOT,
      getSystemConfig: { result: { moduleName: "ESP56_SHTW3_01", fwVersion: "1.28.0" } },
      setPilot: ACK,
    });
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 50, retransmitAfterMs: 0 });
    const report = await checkBulb(light, { holdMs: 0 });
    assert.equal(report.verdict, "white-only");
    assert.equal(report.kind, "tunable-white");
  });

  it("reports a missing acknowledgement separately from an unreachable bulb", async () => {
    const socket = bulb({ getPilot: PILOT, getSystemConfig: COLOR_BULB, getModelConfig: NOT_FOUND });
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 50, retransmitAfterMs: 0 });
    const report = await checkBulb(light, { holdMs: 0 });
    assert.equal(report.verdict, "no-ack");
    assert.equal(report.test.status, "no-reply");
    assert.equal(report.restore, "unconfirmed");
  });

  it("stops after getPilot when the bulb doesn't answer", async () => {
    const socket = bulb({});
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 30, retransmitAfterMs: 0 });
    const report = await checkBulb(light);
    assert.equal(report.verdict, "unreachable");
    assert.match(report.error ?? "", /No getPilot reply/);
    assert.equal(socket.sent.length, 1);
    assert.equal(socket.listenerCount, 0);
  });

  it("can keep the test color on (no restore)", async () => {
    const socket = bulb({ getPilot: PILOT, getSystemConfig: COLOR_BULB, getModelConfig: NOT_FOUND, setPilot: ACK });
    const report = await checkBulb(new WizLight(HOST, socket), {
      restore: false,
      testColor: { r: 0, g: 0, b: 255, dimming: 40 },
    });
    assert.equal(report.restore, "skipped");
    assert.deepEqual(setPilots(socket), [{ state: true, r: 0, g: 0, b: 255, dimming: 40 }]);
  });
});
