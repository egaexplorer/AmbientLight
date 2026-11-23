import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FILM_LOOKS, type ScreenCapturer } from "@ambientlight/core";
import { type AppConfig, applyConfigFile, TitleError, UserError } from "@ambientlight/node";
import { FakeCapturer, FakeSocket, solidFrame } from "../../../packages/core/test/helpers.js";
import type { AppState, FrameView } from "../src/shared/api.js";
import { AppController, type Platform } from "../src/main/controller.js";

const BULB = "192.168.1.50";

/** A bulb at BULB that answers every request; getPilot reports warm white at 60 %. */
function bulbSocket(): FakeSocket {
  const socket = new FakeSocket();
  socket.responder = (d) => {
    const { method } = JSON.parse(d.message) as { method: string };
    const result = method === "getPilot" ? { mac: "a8bb50000001", rssi: -55, state: true, temp: 2700, dimming: 60 } : { success: true };
    return [{ address: BULB, text: JSON.stringify({ method, env: "pro", result }) }];
  };
  return socket;
}

function setup(config: Partial<AppConfig> = { bulbs: [BULB] }) {
  const sockets: FakeSocket[] = [];
  const capturers: Array<FakeCapturer & { closed: boolean }> = [];
  const saved: AppConfig[] = [];
  const states: AppState[] = [];
  const frames: FrameView[] = [];
  const platform: Platform = {
    loadConfig: () => applyConfigFile({ ...config, smoothing: 1 }),
    saveConfig: (c) => {
      saved.push(c);
      return c;
    },
    createSocket: async () => {
      const socket = bulbSocket();
      sockets.push(socket);
      return socket;
    },
    createCapturer: () => {
      const capturer = Object.assign(new FakeCapturer(solidFrame(255, 0, 0)), { closed: false });
      (capturer as ScreenCapturer).close = async () => {
        capturer.closed = true;
      };
      capturers.push(capturer);
      return capturer;
    },
    broadcastAddresses: () => ["192.168.1.255"],
    lookForTitle: async (_kind, title) => {
      if (title === "Pengabdi Setan") {
        const info = { title: "Satan's Slaves", genres: "2017 Indonesian supernatural horror", source: "Wikipedia (CC BY-SA 4.0)", url: "https://en.wikipedia.org/wiki/Satan%27s_Slaves" };
        return { name: "horror", look: FILM_LOOKS.horror, info };
      }
      throw new TitleError("not-found", "No film", { similar: ["Dune Part Two"] });
    },
    now: () => performance.now(),
    discoverMs: 30,
  };
  const controller = new AppController(platform, { state: (s) => states.push(s), frame: (f) => frames.push(f) });
  return { controller, sockets, capturers, saved, states, frames };
}

const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

const setPilots = (socket: FakeSocket) =>
  socket.sent.map((d) => JSON.parse(d.message) as { method: string; params: Record<string, unknown> }).filter((m) => m.method === "setPilot");

describe("AppController", () => {
  it("syncs, streams frame views, and restores the bulb on stop", async () => {
    const { controller, sockets, capturers, states, frames } = setup();
    const started = await controller.startSync();
    assert.equal(started.sync, "running");
    await until(() => frames.length > 0);
    assert.equal(frames[0]!.screen, "#ff0000");
    assert.equal(frames[0]!.bulbText, "dim 100 %");

    const stopped = await controller.stopSync();
    assert.equal(stopped.sync, "idle");
    assert.deepEqual(setPilots(sockets[0]!).at(-1)!.params, { state: true, dimming: 60, temp: 2700 });
    assert.equal(capturers[0]!.closed, true);
    assert.deepEqual(
      states.map((s) => s.sync).filter((s, i, all) => s !== all[i - 1]),
      ["starting", "running", "stopping", "idle"],
    );
  });

  it("asks for a bulb before syncing", async () => {
    const { controller } = setup({ bulbs: [] });
    await assert.rejects(controller.startSync(), UserError);
    assert.equal(controller.getState().sync, "idle");
  });

  it("applies a found look at once while syncing", async () => {
    const { controller, frames } = setup();
    await controller.startSync();
    const result = await controller.findTitle("film", "Pengabdi Setan");
    assert.ok(result.ok);
    assert.equal(result.look.name, "horror");
    assert.equal(controller.getState().look?.title, "Satan's Slaves");
    const seen = frames.length;
    await until(() => frames.length > seen && frames.at(-1)!.bulbText.includes("dim 45 %"));
    await controller.stopSync();
  });

  it("saves the brightness and applies it at once while syncing, 70 meaning the look as designed", async () => {
    const { controller, frames, saved } = setup();
    assert.equal(controller.getState().brightness, 70);
    await controller.setLook({ name: "horror" });
    assert.equal(controller.getState().brightnessCap, 45);
    await controller.startSync();
    const state = await controller.setBrightness(100);
    assert.equal(saved.at(-1)?.brightness, 100);
    assert.equal(state.brightness, 100);
    assert.equal(state.brightnessCap, 64);
    const seen = frames.length;
    await until(() => frames.length > seen && frames.at(-1)!.bulbText.includes("dim 64 %"));
    await controller.stopSync();
  });

  it("returns lookup failures with their code", async () => {
    const { controller } = setup();
    const result = await controller.findTitle("film", "Dune");
    assert.deepEqual(result, { ok: false, code: "not-found", message: "No film", similar: ["Dune Part Two"] });
    assert.equal(controller.getState().look, null);
  });

  it("finds bulbs and saves the chosen ones", async () => {
    const { controller, saved } = setup({ bulbs: [] });
    const found = await controller.discover();
    assert.deepEqual(found, { via: ["192.168.1.255"], bulbs: [{ ip: BULB, mac: "a8bb50000001", rssi: -55, on: true }] });
    const state = await controller.setBulbs([BULB]);
    assert.deepEqual(state.bulbs, [BULB]);
    assert.deepEqual(saved.at(-1)!.bulbs, [BULB]);
  });

  it("blinks a bulb, but not one that is being synced", async () => {
    const { controller, sockets } = setup();
    assert.deepEqual(await controller.identify(BULB), { ok: true });
    assert.ok(setPilots(sockets[0]!).some((m) => m.params.state === false));

    await controller.startSync();
    assert.equal((await controller.identify(BULB)).ok, false);
    await controller.shutdown();
    assert.equal(sockets[0]!.closed, true);
  });
});
