import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPilotMessage,
  parseResponse,
  pilotToRestoreParams,
  sanitizeSetPilot,
  setPilotMessage,
  WIZ_PORT,
} from "../src/index.js";

describe("WiZ protocol", () => {
  it("uses UDP port 38899", () => {
    assert.equal(WIZ_PORT, 38899);
  });

  it("encodes setPilot exactly like the project guide's sample payload", () => {
    assert.equal(
      setPilotMessage({ r: 255, g: 0, b: 0, dimming: 100 }),
      '{"method":"setPilot","params":{"r":255,"g":0,"b":0,"dimming":100}}',
    );
  });

  it("clamps and rounds values into the ranges the firmware accepts", () => {
    assert.deepEqual(sanitizeSetPilot({ r: 300.4, g: -5, b: 127.6, dimming: 3, speed: 500, temp: 20000 }), {
      r: 255,
      g: 0,
      b: 128,
      temp: 10000,
      dimming: 10,
      speed: 200,
    });
  });

  it("encodes getPilot with empty params", () => {
    assert.equal(getPilotMessage(), '{"method":"getPilot","params":{}}');
  });

  it("parses bulb replies and rejects anything else", () => {
    const reply = parseResponse(
      '{"method":"getPilot","env":"pro","result":{"mac":"a8bb50aabbcc","rssi":-55,"state":true,"sceneId":0,"r":255,"g":0,"b":0,"dimming":80}}',
    );
    assert.equal(reply?.method, "getPilot");
    assert.equal(reply?.result?.mac, "a8bb50aabbcc");

    assert.equal(parseResponse("not json"), undefined);
    assert.equal(parseResponse("[1,2,3]"), undefined);
    assert.equal(parseResponse('{"result":{}}'), undefined);
    assert.equal(parseResponse('{"method":"getPilot","result":5}'), undefined);
  });

  describe("pilotToRestoreParams", () => {
    it("restores an off bulb as off", () => {
      assert.deepEqual(pilotToRestoreParams({ state: false, r: 10, dimming: 50 }), { state: false });
    });

    it("restores a scene with its speed and dimming", () => {
      assert.deepEqual(pilotToRestoreParams({ state: true, sceneId: 4, speed: 120, dimming: 60 }), {
        state: true,
        dimming: 60,
        sceneId: 4,
        speed: 120,
      });
    });

    it("restores white color temperature", () => {
      assert.deepEqual(pilotToRestoreParams({ state: true, sceneId: 0, temp: 2700, dimming: 75 }), {
        state: true,
        dimming: 75,
        temp: 2700,
      });
    });

    it("restores an RGB(+CW) color", () => {
      assert.deepEqual(pilotToRestoreParams({ state: true, sceneId: 0, r: 0, g: 128, b: 255, c: 0, w: 0, dimming: 40 }), {
        state: true,
        dimming: 40,
        r: 0,
        g: 128,
        b: 255,
        c: 0,
        w: 0,
      });
    });
  });
});
