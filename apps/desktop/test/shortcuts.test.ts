import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { UserError } from "@ambientlight/node";
import type { AppState, LookChoice, Toast } from "../src/shared/api.js";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from "../src/shared/shortcuts.js";
import {
  lookAt,
  parseShortcutFile,
  readShortcutFile,
  ShortcutActions,
  type ShortcutTarget,
  stepBrightness,
  stepLook,
} from "../src/main/shortcuts.js";

const film = (name: Extract<LookChoice, { set: "film" }>["name"]): LookChoice => ({ set: "film", name });
const game = (name: Extract<LookChoice, { set: "game" }>["name"]): LookChoice => ({ set: "game", name });

/** An app that only remembers what the shortcuts set. */
function fakeApp(state: Partial<AppState> = {}) {
  let current: AppState = {
    bulbs: ["192.168.1.50"],
    sync: "idle",
    look: null,
    error: null,
    notRestored: [],
    brightness: 70,
    brightnessCap: 100,
    ...state,
  };
  const calls: string[] = [];
  const target: ShortcutTarget = {
    getState: () => current,
    isRunning: () => current.sync === "running",
    setLook: async (look) => {
      calls.push("setLook");
      current = { ...current, look };
      return current;
    },
    setBrightness: async (brightness) => {
      calls.push("setBrightness");
      current = { ...current, brightness, brightnessCap: Math.min(100, brightness) };
      return current;
    },
    startSync: async () => {
      calls.push("startSync");
      if (current.bulbs.length === 0) throw new UserError("Add a bulb first: press Find bulbs.");
      current = { ...current, sync: "running" };
      return current;
    },
    stopSync: async () => {
      calls.push("stopSync");
      current = { ...current, sync: "idle" };
      return current;
    },
  };
  const toasts: Toast[] = [];
  const actions = new ShortcutActions(target, (t) => toasts.push(t));
  return {
    actions,
    toasts,
    calls,
    state: () => current,
    /** A look picked outside the shortcuts (a chip or a title). */
    pickInApp: (look: LookChoice | null) => {
      current = { ...current, look };
    },
  };
}

describe("stepping through looks", () => {
  it("goes No look → each film look → No look, both ways", () => {
    assert.deepEqual(stepLook(null, "film", 1), film("horror"));
    assert.deepEqual(stepLook(film("horror"), "film", 1), film("thriller"));
    assert.equal(stepLook(film("drama"), "film", 1), null);
    assert.deepEqual(stepLook(null, "film", -1), film("drama"));
    assert.equal(stepLook(film("horror"), "film", -1), null);
  });

  it("wraps through the seven game looks", () => {
    assert.deepEqual(stepLook(null, "game", 1), game("horror"));
    assert.deepEqual(stepLook(game("strategy"), "game", 1), game("adventure"));
    assert.equal(stepLook(game("adventure"), "game", 1), null);
    assert.deepEqual(stepLook(null, "game", -1), game("adventure"));
  });

  it("starts the set over from a look of the other set", () => {
    assert.deepEqual(stepLook(film("comedy"), "game", 1), game("horror"));
    assert.deepEqual(stepLook(film("comedy"), "game", -1), game("adventure"));
    assert.deepEqual(stepLook(game("cozy"), "film", 1), film("horror"));
  });

  it("numbers the looks in the chips' order", () => {
    assert.deepEqual(lookAt("film", 1), film("horror"));
    assert.deepEqual(lookAt("film", 8), film("drama"));
    assert.deepEqual(lookAt("game", 7), game("adventure"));
    assert.equal(lookAt("game", 8), undefined);
    assert.equal(lookAt("film", 0), undefined);
  });
});

describe("stepping the brightness", () => {
  it("moves to the next multiple of 10, within 10–100", () => {
    assert.equal(stepBrightness(70, 1), 80);
    assert.equal(stepBrightness(70, -1), 60);
    assert.equal(stepBrightness(73, 1), 80);
    assert.equal(stepBrightness(73, -1), 70);
    assert.equal(stepBrightness(100, 1), 100);
    assert.equal(stepBrightness(10, -1), 10);
    assert.equal(stepBrightness(14, -1), 10);
  });
});

describe("shortcut actions", () => {
  it("steps and numbers film looks, and says which look is on", async () => {
    const app = fakeApp();
    await app.actions.run("nextLook");
    assert.deepEqual(app.state().look, film("horror"));
    await app.actions.run("look3");
    assert.deepEqual(app.state().look, film("romance"));
    await app.actions.run("noLook");
    assert.equal(app.state().look, null);
    assert.deepEqual(app.toasts, [
      { kind: "look", look: film("horror"), set: "film" },
      { kind: "look", look: film("romance"), set: "film" },
      { kind: "look", look: null, set: "film" },
    ]);
  });

  it("switches to game looks until the next pick, and keeps the set through No look", async () => {
    const app = fakeApp({ look: film("drama") });
    await app.actions.run("switchSet");
    assert.deepEqual(app.toasts.at(-1), { kind: "set", set: "game" });
    assert.deepEqual(app.state().look, film("drama"), "switching alone keeps the look");
    await app.actions.run("look1");
    assert.deepEqual(app.state().look, game("horror"));
    await app.actions.run("noLook");
    await app.actions.run("nextLook");
    assert.deepEqual(app.state().look, game("horror"));
  });

  it("follows a look picked in the app", async () => {
    const app = fakeApp();
    app.pickInApp(game("cozy"));
    await app.actions.run("nextLook");
    assert.deepEqual(app.state().look, game("platformer"));
    app.pickInApp(film("scifi"));
    await app.actions.run("nextLook");
    assert.deepEqual(app.state().look, film("action"));
  });

  it("says when a number has no game look, and leaves the look alone", async () => {
    const app = fakeApp({ look: game("cozy") });
    await app.actions.run("look8");
    assert.deepEqual(app.state().look, game("cozy"));
    const toast = app.toasts.at(-1);
    assert.equal(toast?.kind, "error");
    assert.match(toast?.kind === "error" ? toast.message : "", /only 7 game looks/);
  });

  it("starts and stops sync, and reports why it can't start", async () => {
    const app = fakeApp();
    await app.actions.run("toggleSync");
    await app.actions.run("toggleSync");
    assert.deepEqual(app.calls, ["startSync", "stopSync"]);
    assert.deepEqual(app.toasts, [
      { kind: "sync", on: true },
      { kind: "sync", on: false },
    ]);

    const empty = fakeApp({ bulbs: [] });
    await empty.actions.run("toggleSync");
    assert.deepEqual(empty.toasts, [{ kind: "error", message: "Add a bulb first: press Find bulbs." }]);
  });

  it("steps the brightness, and doesn't restart the sync at the limit", async () => {
    const app = fakeApp({ brightness: 90 });
    await app.actions.run("brighter");
    await app.actions.run("brighter");
    assert.equal(app.state().brightness, 100);
    assert.deepEqual(app.calls, ["setBrightness"]);
    assert.deepEqual(app.toasts.at(-1), { kind: "brightness", value: 100, cap: 100 });
    await app.actions.run("dimmer");
    assert.equal(app.state().brightness, 90);
  });

  it("drops a press while the previous one is still running", async () => {
    const app = fakeApp();
    const first = app.actions.run("toggleSync");
    assert.equal(await app.actions.run("toggleSync"), false);
    assert.equal(await first, true);
    assert.deepEqual(app.calls, ["startSync"]);
    assert.equal(app.state().sync, "running");
  });
});

describe("shortcuts.json", () => {
  it("fills in missing keys, and turns a key off with null", () => {
    const keys = parseShortcutFile('﻿{ "nextLook": " Ctrl+Shift+N ", "toggleSync": null }', "shortcuts.json");
    assert.equal(keys.nextLook, "Ctrl+Shift+N");
    assert.equal(keys.toggleSync, null);
    assert.equal(keys.look1, DEFAULT_SHORTCUTS.look1);
  });

  it("rejects unknown names, other values, broken JSON and keys used twice", () => {
    assert.throws(() => parseShortcutFile('{ "nextLok": "Ctrl+Alt+L" }', "s.json"), /unknown shortcut "nextLok"/);
    assert.throws(() => parseShortcutFile('{ "nextLook": 5 }', "s.json"), /"nextLook" must be keys/);
    assert.throws(() => parseShortcutFile('{ "nextLook": "" }', "s.json"), UserError);
    assert.throws(() => parseShortcutFile("[]", "s.json"), /JSON object/);
    assert.throws(() => parseShortcutFile("{ nextLook: 1 }", "s.json"), /isn't valid JSON/);
    assert.throws(() => parseShortcutFile('{ "look1": "ctrl+alt+L" }', "s.json"), /"nextLook" and "look1" both use/);
  });

  it("has a default for every action, none used twice", () => {
    assert.deepEqual(Object.keys(DEFAULT_SHORTCUTS), [...SHORTCUT_ACTIONS]);
    assert.deepEqual(parseShortcutFile("{}", "s.json"), DEFAULT_SHORTCUTS);
  });

  it("writes the defaults when the file is missing, and falls back to them when it is broken", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ambient-keys-"));
    try {
      const file = path.join(dir, "sub", "shortcuts.json");
      assert.deepEqual(readShortcutFile(file), { keys: DEFAULT_SHORTCUTS, error: null });
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), DEFAULT_SHORTCUTS);

      fs.writeFileSync(file, '{ "nextLook": "Ctrl+Alt+N" }');
      assert.equal(readShortcutFile(file).keys.nextLook, "Ctrl+Alt+N");

      fs.writeFileSync(file, '{ "jump": "Ctrl+J" }');
      const broken = readShortcutFile(file);
      assert.deepEqual(broken.keys, DEFAULT_SHORTCUTS);
      assert.match(broken.error ?? "", /unknown shortcut "jump".*default keys apply/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
