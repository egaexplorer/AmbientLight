import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverBulbs, WizLight, WizTimeoutError } from "../src/index.js";
import { FakeSocket } from "./helpers.js";

const PILOT_REPLY = (mac: string, rssi = -60): string =>
  JSON.stringify({ method: "getPilot", env: "pro", result: { mac, rssi, state: true, sceneId: 0, temp: 2700, dimming: 70 } });

describe("WizLight", () => {
  it("sends setPilot to the bulb's IP on port 38899", async () => {
    const socket = new FakeSocket();
    await new WizLight("192.168.1.50", socket).setColor({ r: 255, g: 64, b: 0, dimming: 80 });
    assert.deepEqual(socket.sent, [
      {
        address: "192.168.1.50",
        port: 38899,
        message: '{"method":"setPilot","params":{"r":255,"g":64,"b":0,"dimming":80}}',
      },
    ]);
  });

  it("reads state with getPilot, ignoring replies from other bulbs", async () => {
    const socket = new FakeSocket();
    socket.responder = () => [
      { address: "192.168.1.99", text: PILOT_REPLY("other") },
      { address: "192.168.1.50", text: PILOT_REPLY("a8bb50aabbcc") },
    ];
    const state = await new WizLight("192.168.1.50", socket).getPilot();
    assert.equal(state.mac, "a8bb50aabbcc");
    assert.equal(state.temp, 2700);
    assert.equal(socket.listenerCount, 0, "listener should be removed");
  });

  it("times out when the bulb does not answer", async () => {
    const socket = new FakeSocket();
    await assert.rejects(new WizLight("192.168.1.50", socket, { requestTimeoutMs: 20 }).getPilot(), WizTimeoutError);
    assert.equal(socket.listenerCount, 0);
  });

  it("rejects when the bulb returns an error", async () => {
    const socket = new FakeSocket();
    socket.responder = () => [
      { address: "192.168.1.50", text: '{"method":"getPilot","error":{"code":-32600,"message":"Invalid Request"}}' },
    ];
    await assert.rejects(new WizLight("192.168.1.50", socket).getPilot(), /Invalid Request/);
  });
});

describe("discoverBulbs", () => {
  it("broadcasts getPilot and collects unique bulbs sorted by IP", async () => {
    const socket = new FakeSocket();
    socket.responder = (d) =>
      d.address === "192.168.1.255"
        ? [
            { address: "192.168.1.120", text: PILOT_REPLY("bbb", -70) },
            { address: "192.168.1.20", text: PILOT_REPLY("aaa", -50) },
            { address: "192.168.1.20", text: "garbage" },
          ]
        : [];

    const bulbs = await discoverBulbs(socket, {
      broadcastAddresses: ["192.168.1.255", "255.255.255.255"],
      timeoutMs: 120,
      attempts: 2,
    });

    assert.deepEqual(
      bulbs.map((b) => [b.address, b.mac, b.rssi]),
      [
        ["192.168.1.20", "aaa", -50],
        ["192.168.1.120", "bbb", -70],
      ],
    );
    assert.equal(socket.sent.length, 4, "2 addresses × 2 attempts");
    assert.ok(socket.sent.every((d) => d.message === '{"method":"getPilot","params":{}}' && d.port === 38899));
    assert.equal(socket.listenerCount, 0);
  });

  it("returns an empty list when nothing answers", async () => {
    assert.deepEqual(await discoverBulbs(new FakeSocket(), { timeoutMs: 100, attempts: 1 }), []);
  });
});
