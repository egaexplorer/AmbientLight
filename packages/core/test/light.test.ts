import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bulbKindFromModule,
  discoverBulbs,
  isSignedResponse,
  WIZ_ERROR_INVALID_PARAMS,
  WizLight,
  WizResponseError,
  WizTimeoutError,
} from "../src/index.js";
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

  it("sends the white LED channels of pale colors", async () => {
    const socket = new FakeSocket();
    await new WizLight("192.168.1.50", socket).setColor({ r: 244, g: 110, b: 0, c: 0, w: 128, dimming: 53 });
    assert.equal(socket.sent[0]?.message, '{"method":"setPilot","params":{"r":244,"g":110,"b":0,"c":0,"w":128,"dimming":53}}');
  });

  it("sends white-mode colors as a color temperature", async () => {
    const socket = new FakeSocket();
    await new WizLight("192.168.1.50", socket).setColor({ r: 255, g: 255, b: 255, dimming: 60, temp: 4000 });
    assert.equal(socket.sent[0]?.message, '{"method":"setPilot","params":{"temp":4000,"dimming":60}}');
  });

  it("turns the light on and off with a bare state", async () => {
    const socket = new FakeSocket();
    const light = new WizLight("192.168.1.50", socket);
    await light.turnOff();
    await light.turnOn();
    assert.deepEqual(
      socket.sent.map((s) => s.message),
      ['{"method":"setPilot","params":{"state":false}}', '{"method":"setPilot","params":{"state":true}}'],
    );
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

describe("WizLight requests", () => {
  const HOST = "192.168.1.50";
  const methodOf = (message: string): string => (JSON.parse(message) as { method: string }).method;
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it("retransmits once when the first datagram gets no reply", async () => {
    const socket = new FakeSocket();
    let calls = 0;
    socket.responder = () => (++calls === 2 ? [{ address: HOST, text: PILOT_REPLY("a8bb50aabbcc") }] : []);
    const light = new WizLight(HOST, socket, { requestTimeoutMs: 300, retransmitAfterMs: 20 });
    const state = await light.getPilot();
    assert.equal(state.mac, "a8bb50aabbcc");
    assert.equal(socket.sent.length, 2);
  });

  it("does not retransmit once a reply arrived", async () => {
    const socket = new FakeSocket();
    socket.responder = () => [{ address: HOST, text: PILOT_REPLY("a8bb50aabbcc") }];
    await new WizLight(HOST, socket, { retransmitAfterMs: 20 }).getPilot();
    await wait(40);
    assert.equal(socket.sent.length, 1);
  });

  it("confirms setPilot and reports rejections with their error code", async () => {
    const socket = new FakeSocket();
    let reply = '{"method":"setPilot","env":"pro","result":{"success":true}}';
    socket.responder = (d) => (methodOf(d.message) === "setPilot" ? [{ address: HOST, text: reply }] : []);
    const light = new WizLight(HOST, socket);

    await light.setPilotConfirmed({ r: 255, g: 0, b: 0, dimming: 100 });

    reply = '{"method":"setPilot","env":"pro","hmac":"abc=","error":{"code":-32602,"message":"Invalid params"}}';
    await assert.rejects(light.setPilotConfirmed({ r: 255, g: 0, b: 0 }), (error: unknown) => {
      assert.ok(error instanceof WizResponseError);
      assert.equal(error.code, WIZ_ERROR_INVALID_PARAMS);
      assert.ok(isSignedResponse(error.response));
      return true;
    });
  });

  it("reads the system config", async () => {
    const socket = new FakeSocket();
    socket.responder = () => [
      {
        address: HOST,
        text: '{"method":"getSystemConfig","env":"pro","result":{"mac":"a8bb50aabbcc","moduleName":"ESP25_SHRGB_01","fwVersion":"1.31.0"}}',
      },
    ];
    const config = await new WizLight(HOST, socket).getSystemConfig();
    assert.equal(config.moduleName, "ESP25_SHRGB_01");
    assert.equal(config.fwVersion, "1.31.0");
    assert.equal(socket.sent[0]?.message, '{"method":"getSystemConfig","params":{}}');
  });
});

describe("bulbKindFromModule", () => {
  it("reads the LED setup from the module name", () => {
    assert.equal(bulbKindFromModule("ESP25_SHRGB_01"), "color");
    assert.equal(bulbKindFromModule("ESP20_DHRGB_01"), "color");
    assert.equal(bulbKindFromModule("ESP56_SHTW3_01"), "tunable-white");
    assert.equal(bulbKindFromModule("ESP06_SHDW9_01"), "dimmable-white");
    assert.equal(bulbKindFromModule("ESP10_SOCKET_06"), "socket");
    assert.equal(bulbKindFromModule("SOMETHING"), "unknown");
    assert.equal(bulbKindFromModule(undefined), "unknown");
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
